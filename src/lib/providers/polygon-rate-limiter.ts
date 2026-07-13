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
import {
  rateLimiterEnvNumber,
  computeDegradedLocalRps,
  type RateLimiterRedisClient,
  acquireSlidingWindowRedisSlot,
  ensureProviderBreakerSubscription,
  type BreakerSubscriptionState,
} from "./provider-rate-limiter-shared";

export { computeDegradedLocalRps } from "./provider-rate-limiter-shared";

const envNumber = rateLimiterEnvNumber;

/**
 * Per-process pacing — PERMISSIVE. Default 150 rps; Polygon/Massive Advanced is effectively
 * unlimited (no published RPS cap), so the self-cap exists only to bound a runaway loop, not to
 * respect a provider quota. Raised 40 → 150 to let the parallelizable heavy paths (GEX-heatmap
 * chain pagination, intraday reconstruction's 40+ page chain pull) drain faster — "all the data,
 * quickly rendered at the earliest." The consecutive-429 circuit breaker below still trips and
 * cluster-broadcasts if the provider ever does push back, so a higher ceiling can't run away.
 */
const MAX_RPS = envNumber("POLYGON_MAX_RPS", 150);
/** Cluster-wide ceiling when REDIS_URL is set — shared by worker + web app. Matches MAX_RPS. */
const GLOBAL_MAX_RPS = envNumber("POLYGON_GLOBAL_MAX_RPS", 150);
/** Live replica count of this service — divides the global budget across replicas on Redis loss. */
const REPLICA_COUNT = Math.max(1, Math.floor(envNumber("REPLICA_COUNT", 1)));

/**
 * Per-replica RPS the local bucket may sustain when the Redis global ceiling is UNAVAILABLE.
 * With Redis up, the atomic Lua ceiling is the real cluster cap and the local bucket is just a
 * smoother (full MAX_RPS). With Redis DOWN (fail-open) the local bucket is the ONLY cap, so N
 * replicas each pacing at MAX_RPS would emit N*MAX_RPS and breach the cluster ceiling (gap #1).
 * Dividing GLOBAL/ N gives an EXACT cluster cap of GLOBAL_MAX_RPS; fractional on purpose so it
 * stays exact at N>2. The 0.1 guard only protects a misconfigured-high REPLICA_COUNT from
 * starvation; for realistic N the cluster cap stays exact.
 */
const DEGRADED_LOCAL_RPS = computeDegradedLocalRps(GLOBAL_MAX_RPS, REPLICA_COUNT);
const MAX_CONCURRENCY = Math.max(1, Math.floor(envNumber("POLYGON_MAX_CONCURRENCY", 48)));
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
const breakerSubState: BreakerSubscriptionState = { subscribed: false };

function ensureBreakerSubscription(): void {
  ensureProviderBreakerSubscription(breakerSubState, BREAKER_CHANNEL, (peer) => {
    circuitOpenUntil = mergePolyBreakerOpenUntil(
      circuitOpenUntil,
      peer,
      Date.now(),
      BREAKER_MAX_FUTURE_MS
    );
  });
}

type RedisClient = RateLimiterRedisClient;

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

/** True when the Redis global ceiling is currently active (REDIS_URL set, not in failure backoff). */
function redisGlobalActive(): boolean {
  return (
    Boolean(process.env.REDIS_URL?.trim()) &&
    !(sharedRedisFailedAt && Date.now() - sharedRedisFailedAt < SHARED_REDIS_RETRY_BACKOFF_MS)
  );
}

/**
 * Effective local token-bucket rate. Redis ceiling healthy → full per-process MAX_RPS (the Lua
 * ceiling is the real cap). Redis down → the local bucket is the only cap, so it drops to the
 * per-replica DEGRADED_LOCAL_RPS so the cluster sum can never exceed GLOBAL_MAX_RPS (gap #1).
 */
function effectiveMaxRps(): number {
  return redisGlobalActive() ? MAX_RPS : DEGRADED_LOCAL_RPS;
}

function refillTokens(): void {
  const now = Date.now();
  const elapsedSec = (now - lastRefillMs) / 1000;
  if (elapsedSec <= 0) return;
  const rate = effectiveMaxRps();
  // Burst capacity is >=1 so a call can always eventually admit even when the sustained rate is
  // fractional (e.g. 40 RPS / 3 replicas = 13.3); the refill RATE is what paces the long run.
  const capacity = Math.max(1, rate);
  tokens = Math.min(capacity, tokens + elapsedSec * rate);
  lastRefillMs = now;
}

function waitMsForToken(): number {
  refillTokens();
  if (tokens >= 1) return 0;
  const rate = effectiveMaxRps();
  const deficit = 1 - tokens;
  return Math.max(25, Math.ceil((deficit / rate) * 1000));
}

async function acquireGlobalRedisSlot(): Promise<boolean> {
  const client = await getSharedRedis();
  if (!client) return true; // FAIL-OPEN: no Redis → no global ceiling.

  try {
    return await acquireSlidingWindowRedisSlot(client, "blackout:polygon:rps", GLOBAL_MAX_RPS);
  } catch {
    // Redis died mid-session: arm the backoff so getSharedRedis() falls back to
    // local-only pacing for SHARED_REDIS_RETRY_BACKOFF_MS instead of awaiting a
    // dead client on every hot-path call. Tear down the old client (ioredis would
    // otherwise keep auto-reconnecting in the background).
    sharedRedisFailedAt = Date.now();
    const dead = sharedRedis;
    sharedRedis = null;
    try { dead?.disconnect(); } catch { /* ignore */ }
    // Degraded mode: the global ceiling is gone, so the local bucket now paces at the per-replica
    // DEGRADED_LOCAL_RPS budget. REPLICA_COUNT MUST be set for N>1 or the cluster can still
    // overshoot. Logged ~once per backoff window (not per call) since getSharedRedis short-circuits.
    console.warn(
      `[polygon] Redis ceiling unavailable — degraded to per-replica pacing ${DEGRADED_LOCAL_RPS.toFixed(
        2
      )} rps (REPLICA_COUNT=${REPLICA_COUNT}). Set REPLICA_COUNT to the live replica count.`
    );
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
      // Reserve the slot synchronously BEFORE pacing so no concurrent acquirer can
      // observe the un-consumed token/concurrency across the await and overshoot.
      tokens -= 1;
      inFlight += 1;
      try {
        await waitMinSpacing();
      } catch (err) {
        // Release concurrency on failure; do NOT refund the token (rate budget is
        // consumed per admitted call, mirroring releaseSlot which never refunds tokens).
        inFlight = Math.max(0, inFlight - 1);
        throw err;
      }
      return;
    }
    const delay = inFlight >= MAX_CONCURRENCY ? 50 : waitMsForToken();
    await new Promise((r) => setTimeout(r, delay));
  }
}

/**
 * Await a REST slot before a Polygon REST call. PERMISSIVE + FAIL-OPEN: on the
 * uncontended path this returns after a synchronous token refill with no Redis hit and
 * no sleep. The breaker subscription is ensured here so a peer trip can arrive passively,
 * and acquirePolygonSlot blocks on the breaker via waitForCircuit() (mirroring the UW
 * limiter) so the breaker is honored even for callers that don't pre-check
 * isPolygonCircuitOpen(); polygonTrackedFetch still short-circuits via that helper too.
 */
export async function acquirePolygonSlot(_lane?: "default" | "nights-watch"): Promise<void> {
  ensureBreakerSubscription();
  await waitForCircuit();
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
  breakerSubState.subscribed = false;
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
  replicaCount: number;
  degradedLocalRps: number;
  maxConcurrency: number;
  minSpacingMs: number;
  inFlight: number;
  tokens: number;
  redisGlobal: boolean;
  degraded: boolean;
  circuitOpen: boolean;
  circuitOpenUntil: number | null;
  consecutive429: number;
} {
  refillTokens();
  const now = Date.now();
  const redisGlobal = redisGlobalActive();
  return {
    maxRps: MAX_RPS,
    globalMaxRps: GLOBAL_MAX_RPS,
    replicaCount: REPLICA_COUNT,
    degradedLocalRps: DEGRADED_LOCAL_RPS,
    maxConcurrency: MAX_CONCURRENCY,
    minSpacingMs: MIN_SPACING_MS,
    inFlight,
    tokens,
    redisGlobal,
    // Degraded = global ceiling gone AND we actually divide (multi-replica). A single replica on
    // local pacing is NOT degraded — it is the whole cluster, so full MAX_RPS is correct.
    degraded: !redisGlobal && REPLICA_COUNT > 1,
    circuitOpen: now < circuitOpenUntil,
    circuitOpenUntil: now < circuitOpenUntil ? circuitOpenUntil : null,
    consecutive429,
  };
}
