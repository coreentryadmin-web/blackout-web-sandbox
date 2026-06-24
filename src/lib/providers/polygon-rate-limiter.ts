/**
 * Polygon REST throttle — token bucket, optional Redis-global ceiling, min spacing,
 * concurrency cap, and the cluster-aware reactive circuit breaker.
 *
 * Mirrors lib/providers/uw-rate-limiter.ts EXACTLY in shape, but is PERMISSIVE: Polygon
 * Advanced is high-throughput, so the buckets only smooth bursts large enough to trip the
 * reactive 5-consecutive-429 breaker. On the uncontended common path acquirePolygonSlot()
 * returns synchronously after one refill (no Redis round-trip, no sleep) so we never add
 * latency to the hot desk/GEX/pulse loops.
 *
 * FAIL-OPEN: when REDIS_URL is unset or Redis is unavailable the global ceiling is skipped
 * and we fall back to local-only pacing (exactly like UW). acquirePolygonSlot() never throws.
 *
 * BREAKER RECONCILIATION: this module now OWNS the reactive Polygon breaker that previously
 * lived inline in providers/polygon.ts (5 consecutive 429s → 60s pause, cluster pub/sub via
 * blackout:polygon:breaker + mergePolyBreakerOpenUntil). The counter stays consecutive (reset
 * on the next OK) — identical to the old behavior — so wiring every REST funnel through
 * notePolygon429()/notePolygonOk() does NOT double-count: there is exactly one breaker.
 */

import { trackedFetch, type TrackedFetchOptions } from "@/lib/api-tracked-fetch";
import { mergePolyBreakerOpenUntil } from "./polygon-breaker-merge";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per-process pacing — PERMISSIVE. Default 40 rps; Polygon Advanced is high-throughput. */
const MAX_RPS = envNumber("POLYGON_MAX_RPS", 40);
/** Cluster-wide ceiling when REDIS_URL is set — shared by worker + web app. */
const GLOBAL_MAX_RPS = envNumber("POLYGON_GLOBAL_MAX_RPS", 40);
const MAX_CONCURRENCY = Math.max(1, Math.floor(envNumber("POLYGON_MAX_CONCURRENCY", 24)));
/** Default 0 — no inter-call spacing on the permissive Polygon path. */
const MIN_SPACING_MS = Math.max(0, Math.floor(envNumber("POLYGON_MIN_SPACING_MS", 0)));
/** Absorbs the old reactive breaker: 5 CONSECUTIVE 429s → pause. */
const CIRCUIT_429_THRESHOLD = Math.max(3, Math.floor(envNumber("POLYGON_CIRCUIT_429_THRESHOLD", 5)));
const CIRCUIT_PAUSE_MS = Math.max(10_000, Math.floor(envNumber("POLYGON_CIRCUIT_PAUSE_MS", 60_000)));

const SUMMARY_WINDOW_MS = 60_000;

let tokens = MAX_RPS;
let lastRefillMs = Date.now();
let lastStartMs = 0;
let inFlight = 0;

let circuitOpenUntil = 0;
/** CONSECUTIVE 429 count — reset on the next OK. Mirrors the old polygon.ts _poly429Count. */
let consecutive429 = 0;
let rateLimitSummaryCount = 0;
let rateLimitSummaryWindowStart = Date.now();

/** Pub/sub channel a replica uses to broadcast its breaker trip to peers. */
const BREAKER_CHANNEL = "blackout:polygon:breaker";
/**
 * Largest future a peer's breaker trip may push our pause to. A poisoned/buggy peer
 * publishing openUntil = year 3000 must NOT wedge this replica open forever, so we
 * clamp to a few normal pause windows ahead of local now.
 */
const BREAKER_MAX_FUTURE_MS = CIRCUIT_PAUSE_MS * 3;
let breakerSubscribed = false;

/**
 * Lazy, once-per-process passive subscriber: a peer's trip extends our pause.
 * redis-pubsub is DYNAMICALLY imported (no static @/ on the hot path; mirrors UW) and
 * no-ops with no Redis (local-only breaker, exactly as before).
 */
function ensureBreakerSubscription(): void {
  if (breakerSubscribed) return;
  breakerSubscribed = true; // set before await: prevents duplicate subscribe races
  void import("@/lib/redis-pubsub")
    .then(({ redisSubscribe }) =>
      redisSubscribe(BREAKER_CHANNEL, (msg) => {
        try {
          const parsed = JSON.parse(msg) as { openUntil?: unknown };
          const peer = typeof parsed.openUntil === "number" ? parsed.openUntil : NaN;
          circuitOpenUntil = mergePolyBreakerOpenUntil(
            circuitOpenUntil,
            peer,
            Date.now(),
            BREAKER_MAX_FUTURE_MS
          );
        } catch {
          /* ignore malformed peer message */
        }
      })
    )
    .catch(() => {
      breakerSubscribed = false; // allow a later retry if the import/subscribe failed
    });
}

type RedisClient = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
  disconnect(): void;
};

let sharedRedis: RedisClient | null = null;
let sharedRedisFailedAt = 0;
const SHARED_REDIS_RETRY_BACKOFF_MS = 30_000;

async function getSharedRedis(): Promise<RedisClient | null> {
  // Backoff, not a permanent kill-switch: after a Redis blip the cluster-wide limiter
  // retries once the window elapses instead of degrading to local-only pacing forever.
  if (sharedRedisFailedAt && Date.now() - sharedRedisFailedAt < SHARED_REDIS_RETRY_BACKOFF_MS) {
    return null;
  }
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (sharedRedis) return sharedRedis;

  try {
    const { makeRedis } = await import("../make-redis");
    const client = await makeRedis("polygon-rate-limiter", url, { maxRetriesPerRequest: 1 });
    sharedRedis = client as unknown as RedisClient;
    sharedRedisFailedAt = 0; // clear failure on success
    return sharedRedis;
  } catch {
    sharedRedisFailedAt = Date.now();
    return null;
  }
}

function refillTokens(): void {
  const now = Date.now();
  const elapsedSec = (now - lastRefillMs) / 1000;
  if (elapsedSec <= 0) return;
  tokens = Math.min(MAX_RPS, tokens + elapsedSec * MAX_RPS);
  lastRefillMs = now;
}

function waitMsForToken(): number {
  refillTokens();
  if (tokens >= 1) return 0;
  const deficit = 1 - tokens;
  return Math.max(25, Math.ceil((deficit / MAX_RPS) * 1000));
}

/**
 * Lua script for atomic sliding-window rate-limit check-and-increment.
 *
 * Keys:  KEYS[1] = currKey, KEYS[2] = prevKey
 * Args:  ARGV[1] = elapsedFrac (0..1, fraction of current second elapsed)
 *        ARGV[2] = limit       (GLOBAL_MAX_RPS)
 *        ARGV[3] = ttl         (seconds to keep the counter key alive)
 *
 * Returns 1 if the request is allowed (counter incremented), 0 if denied. Runs
 * atomically in Redis so no concurrent caller can interleave read and write.
 */
const RATE_LIMIT_LUA = `
local curr = tonumber(redis.call('GET', KEYS[1])) or 0
local prev = tonumber(redis.call('GET', KEYS[2])) or 0
local elapsed_frac = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local estimated = curr + prev * (1 - elapsed_frac)
if estimated >= limit then
  return 0
end
local new_count = redis.call('INCR', KEYS[1])
if new_count == 1 then
  redis.call('EXPIRE', KEYS[1], ttl)
end
return 1
`;

async function acquireGlobalRedisSlot(): Promise<boolean> {
  const client = await getSharedRedis();
  if (!client) return true; // FAIL-OPEN: no Redis → no global ceiling.

  const nowMs = Date.now();
  const sec = Math.floor(nowMs / 1000);
  const elapsedFrac = (nowMs % 1000) / 1000;
  const currKey = `blackout:polygon:rps:${sec}`;
  const prevKey = `blackout:polygon:rps:${sec - 1}`;

  try {
    const allowed = await client.eval(
      RATE_LIMIT_LUA,
      2, // numkeys
      currKey,
      prevKey,
      elapsedFrac.toFixed(6),
      GLOBAL_MAX_RPS,
      3 // TTL seconds
    );
    return allowed === 1;
  } catch {
    return true; // FAIL-OPEN on any Redis error.
  }
}

async function waitForCircuit(): Promise<void> {
  for (;;) {
    const now = Date.now();
    if (now >= circuitOpenUntil) return;
    await new Promise((r) => setTimeout(r, Math.min(500, circuitOpenUntil - now)));
  }
}

async function waitMinSpacing(): Promise<void> {
  if (MIN_SPACING_MS <= 0) return;
  const now = Date.now();
  const wait = MIN_SPACING_MS - (now - lastStartMs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStartMs = Date.now();
}

async function acquireLocalSlot(): Promise<void> {
  for (;;) {
    refillTokens();
    if (inFlight < MAX_CONCURRENCY && tokens >= 1) {
      await waitMinSpacing();
      tokens -= 1;
      inFlight += 1;
      return;
    }
    const delay = inFlight >= MAX_CONCURRENCY ? 50 : waitMsForToken();
    await new Promise((r) => setTimeout(r, delay));
  }
}

/**
 * Await a REST slot before a Polygon REST call. PERMISSIVE + FAIL-OPEN: on the
 * uncontended path this returns after a synchronous token refill with no Redis hit and
 * no sleep. NOTE: this gate is reactive-breaker-aware — it does NOT block on the breaker
 * here; callers short-circuit via isPolygonCircuitOpen() (mirrors the old polygon.ts gate,
 * which threw immediately instead of waiting). The breaker subscription is ensured here so
 * a peer trip can still arrive passively.
 */
export async function acquirePolygonSlot(_lane?: "default" | "nights-watch"): Promise<void> {
  ensureBreakerSubscription();
  if (process.env.REDIS_URL?.trim()) {
    for (;;) {
      if (await acquireGlobalRedisSlot()) {
        await acquireLocalSlot();
        return;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  await acquireLocalSlot();
}

function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
}

function maybeFlushRateLimitSummary(now: number): void {
  if (now - rateLimitSummaryWindowStart < SUMMARY_WINDOW_MS) return;
  if (rateLimitSummaryCount > 0) {
    console.warn(`[polygon] ${rateLimitSummaryCount} rate-limited responses in last 60s`);
  }
  rateLimitSummaryCount = 0;
  rateLimitSummaryWindowStart = now;
}

/** True while the circuit breaker is pausing new Polygon REST calls (SYNC read — hot-path safe). */
export function isPolygonCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

/**
 * Record a 429 — increments the CONSECUTIVE counter and may open the breaker.
 * Mirrors the old polygon.ts logic byte-for-byte: at the threshold it opens for
 * CIRCUIT_PAUSE_MS, resets the counter, and broadcasts the trip to peers.
 */
export function notePolygon429(_path?: string): void {
  const now = Date.now();
  consecutive429 += 1;
  rateLimitSummaryCount += 1;

  if (consecutive429 >= CIRCUIT_429_THRESHOLD && now >= circuitOpenUntil) {
    circuitOpenUntil = now + CIRCUIT_PAUSE_MS;
    consecutive429 = 0;
    // Broadcast ONLY on the rare trip (never per call). Fire-and-forget via a lazy
    // dynamic import; peers Math.max-merge it to extend their own pause. No-ops with no
    // Redis (local-only breaker exactly as today).
    void import("@/lib/redis-pubsub")
      .then(({ redisPublish }) =>
        redisPublish(BREAKER_CHANNEL, JSON.stringify({ openUntil: circuitOpenUntil }))
      )
      .catch(() => {});
    console.warn(
      `[polygon] Circuit opened after ${CIRCUIT_429_THRESHOLD} consecutive 429s — pausing ${Math.round(
        CIRCUIT_PAUSE_MS / 1000
      )}s`
    );
  }
  maybeFlushRateLimitSummary(now);
}

/** Record a non-429 response — resets the consecutive-429 counter (mirrors old `if (res.ok)`). */
export function notePolygonOk(): void {
  consecutive429 = 0;
}

// Test-only: clear breaker state between cases (module state persists across a test
// file). Not used in production code.
export function resetPolygonCircuitForTest(): void {
  circuitOpenUntil = 0;
  consecutive429 = 0;
  rateLimitSummaryCount = 0;
  breakerSubscribed = false;
}

/**
 * The SINGLE Polygon REST funnel. Every Polygon REST fetch (desk / GEX / Largo / chain /
 * snapshot / play / lotto / power-hour) goes through here so all of it is smoothed by the
 * permissive bucket and gated by the one reactive breaker.
 *
 * Order mirrors the old polygon.ts polygonGet: short-circuit when the breaker is open
 * (throws, so callers' existing try/catch degrade exactly as before), then acquire a slot,
 * then fetch. On 429 → notePolygon429 (may trip the breaker) AND the original tracked
 * Response is returned to the caller unchanged, so res.status/res.ok handling is preserved.
 * On any non-429 response notePolygonOk resets the consecutive counter.
 *
 * FAIL-OPEN: acquirePolygonSlot never throws; if Redis is down it degrades to local pacing.
 */
export async function polygonTrackedFetch(
  endpointKey: string,
  url: string,
  init?: TrackedFetchOptions
): Promise<Response> {
  if (isPolygonCircuitOpen()) {
    const waitSec = Math.ceil((circuitOpenUntil - Date.now()) / 1000);
    throw new Error(`[polygon] Circuit open — rate limited, pausing ${waitSec}s`);
  }

  await acquirePolygonSlot();
  try {
    // RT-2 resilience: retry TRANSIENT failures (connect errors like UND_ERR_CONNECT_TIMEOUT /
    // EHOSTUNREACH, plus 5xx and 429) once with a short backoff, so a momentary api.massive.com
    // blip no longer hard-fails the desk / SPX-play (was a 502). trackedFetch does NOT retry 4xx
    // (404/403) and success is unaffected — only an already-failing call pays the extra attempt.
    // All Massive REST is GET (idempotent), so the retry is safe. Caller-overridable.
    const res = await trackedFetch("polygon", endpointKey, url, {
      maxRetries: 1,
      retryDelayMs: 350,
      ...(init ?? {}),
    });
    if (res.status === 429) {
      notePolygon429(endpointKey);
    } else {
      notePolygonOk();
    }
    return res;
  } finally {
    releaseSlot();
  }
}

export function polygonRateLimiterStats(): {
  maxRps: number;
  globalMaxRps: number;
  maxConcurrency: number;
  minSpacingMs: number;
  inFlight: number;
  tokens: number;
  redisGlobal: boolean;
  circuitOpen: boolean;
  circuitOpenUntil: number | null;
  consecutive429: number;
} {
  refillTokens();
  const now = Date.now();
  return {
    maxRps: MAX_RPS,
    globalMaxRps: GLOBAL_MAX_RPS,
    maxConcurrency: MAX_CONCURRENCY,
    minSpacingMs: MIN_SPACING_MS,
    inFlight,
    tokens,
    redisGlobal:
      Boolean(process.env.REDIS_URL?.trim()) &&
      !(sharedRedisFailedAt && now - sharedRedisFailedAt < SHARED_REDIS_RETRY_BACKOFF_MS),
    circuitOpen: now < circuitOpenUntil,
    circuitOpenUntil: now < circuitOpenUntil ? circuitOpenUntil : null,
    consecutive429,
  };
}
