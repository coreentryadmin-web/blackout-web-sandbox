/** UW API throttle — token bucket, min spacing, in-flight dedup, circuit breaker. */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per-process pacing; default 2 rps. Override via UW_MAX_RPS (e.g. lower on the worker
 *  than on web when no Redis-global ceiling is in play). */
const MAX_RPS = envNumber("UW_MAX_RPS", 2);
/** Cluster-wide ceiling when REDIS_URL is set — shared by worker + web app. */
const GLOBAL_MAX_RPS = envNumber("UW_GLOBAL_MAX_RPS", 2);
const MAX_CONCURRENCY = Math.max(1, Math.floor(envNumber("UW_MAX_CONCURRENCY", 3)));
const MIN_SPACING_MS = Math.max(0, Math.floor(envNumber("UW_MIN_SPACING_MS", 300)));
const CIRCUIT_429_THRESHOLD = Math.max(3, Math.floor(envNumber("UW_CIRCUIT_429_THRESHOLD", 8)));
const CIRCUIT_PAUSE_MS = Math.max(10_000, Math.floor(envNumber("UW_CIRCUIT_PAUSE_MS", 45_000)));

const SUMMARY_WINDOW_MS = 60_000;

let tokens = MAX_RPS;
let lastRefillMs = Date.now();
let lastStartMs = 0;
let inFlight = 0;

let circuitOpenUntil = 0;
let recent429Timestamps: number[] = [];
let rateLimitSummaryCount = 0;
let rateLimitSummaryWindowStart = Date.now();

/** Pub/sub channel a replica uses to broadcast its breaker trip to peers. */
const BREAKER_CHANNEL = "blackout:uw:breaker";
/**
 * Largest future a peer's breaker trip may push our pause to. A poisoned/buggy peer
 * publishing openUntil = year 3000 must NOT wedge this replica open forever, so we
 * clamp to a few normal pause windows ahead of local now.
 */
const BREAKER_MAX_FUTURE_MS = CIRCUIT_PAUSE_MS * 3;
let breakerSubscribed = false;

/**
 * Pure merge: given the current breaker deadline, a peer-published openUntil, the
 * current clock, and the max future window, return the new deadline. Idempotent
 * (Math.max) so a replica receiving its own trip is harmless — no INSTANCE_ID needed.
 * Clamps any peer value beyond now+maxFutureMs (poison guard) and ignores non-finite
 * / past values (returns current unchanged).
 */
export function mergeBreakerOpenUntil(
  current: number,
  peerOpenUntil: number,
  now: number,
  maxFutureMs: number = BREAKER_MAX_FUTURE_MS
): number {
  if (!Number.isFinite(peerOpenUntil) || peerOpenUntil <= now) return current;
  const clamped = Math.min(peerOpenUntil, now + maxFutureMs);
  return Math.max(current, clamped);
}

/**
 * Lazy, once-per-process passive subscriber: a peer's trip extends our pause.
 * redis-pubsub is DYNAMICALLY imported (no static @/ dep — keeps this module + its unit
 * tests alias-free, mirrors getSharedRedis) and no-ops with no Redis (local-only breaker).
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
          circuitOpenUntil = mergeBreakerOpenUntil(circuitOpenUntil, peer, Date.now());
        } catch {
          /* ignore malformed peer message */
        }
      })
    )
    .catch(() => {
      breakerSubscribed = false; // allow a later retry if the import/subscribe failed
    });
}

const coalescedInflight = new Map<string, Promise<unknown>>();

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
  // Backoff, not a permanent kill-switch: after a Redis blip the cluster-wide UW limiter
  // retries once the window elapses instead of degrading to local-only pacing forever.
  if (sharedRedisFailedAt && Date.now() - sharedRedisFailedAt < SHARED_REDIS_RETRY_BACKOFF_MS) {
    return null;
  }
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (sharedRedis) return sharedRedis;

  try {
    const mod = await import("ioredis");
    const Redis = mod.default;
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 2_000,
    });
    // Without an 'error' listener, ioredis throws on the EventEmitter when the
    // connection drops post-connect — which crashes the whole process/replica.
    client.on("error", (err) => console.warn("[uw-rate-limiter] redis error:", err instanceof Error ? err.message : err));
    await client.connect();
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
 * Returns 1 if the request is allowed (counter incremented), 0 if denied.
 *
 * The script reads prevKey and currKey, computes the weighted sliding-window
 * estimate, and only increments currKey when the result would be within the
 * limit.  Because Lua scripts run atomically in Redis, no concurrent caller
 * can interleave between the read and the write.
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
  if (!client) return true;

  const nowMs = Date.now();
  const sec = Math.floor(nowMs / 1000);
  const elapsedFrac = (nowMs % 1000) / 1000;
  const currKey = `blackout:uw:rps:${sec}`;
  const prevKey = `blackout:uw:rps:${sec - 1}`;

  try {
    // Atomically check the sliding-window estimate and increment in one
    // Redis round-trip.  Replaces the previous GET+INCR two-step that had
    // a race window where concurrent callers could both pass the gate.
    const allowed = await client.eval(
      RATE_LIMIT_LUA,
      2,           // numkeys
      currKey,
      prevKey,
      elapsedFrac.toFixed(6),
      GLOBAL_MAX_RPS,
      3,           // TTL seconds
    );
    return allowed === 1;
  } catch {
    return true;
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

async function acquireSlot(): Promise<void> {
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
    console.warn(`[uw] ${rateLimitSummaryCount} rate-limited endpoints in last 60s`);
  }
  rateLimitSummaryCount = 0;
  rateLimitSummaryWindowStart = now;
}

/** Stable cache/dedup key for a UW GET. */
export function buildUwRequestKey(path: string, params: Record<string, string | number> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const sorted = Array.from(qs.entries()).sort(([a], [b]) => a.localeCompare(b));
  const q = new URLSearchParams(sorted).toString();
  return q ? `${path}?${q}` : path;
}

/** True while circuit breaker is pausing new UW HTTP calls. */
export function isUwCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

/** Record a 429 — may open circuit breaker and aggregate log summary. */
export function noteUw429(_path?: string): void {
  const now = Date.now();
  recent429Timestamps = recent429Timestamps.filter((t) => now - t < SUMMARY_WINDOW_MS);
  recent429Timestamps.push(now);
  rateLimitSummaryCount += 1;

  if (recent429Timestamps.length >= CIRCUIT_429_THRESHOLD && now >= circuitOpenUntil) {
    circuitOpenUntil = now + CIRCUIT_PAUSE_MS;
    // Broadcast ONLY on the rare trip (never per call). Fire-and-forget via a lazy
    // dynamic import; peers Math.max-merge it to extend their own pause. No-ops with no
    // Redis (local-only breaker exactly as today).
    void import("@/lib/redis-pubsub")
      .then(({ redisPublish }) => redisPublish(BREAKER_CHANNEL, JSON.stringify({ openUntil: circuitOpenUntil })))
      .catch(() => {});
    console.warn(
      `[uw] circuit breaker open ${Math.round(CIRCUIT_PAUSE_MS / 1000)}s (${recent429Timestamps.length} 429s in 60s)`
    );
  }
  maybeFlushRateLimitSummary(now);
}

// Test-only: clear breaker state between cases (module state persists across a test
// file). Not used in production code.
export function resetUwCircuitForTest(): void {
  circuitOpenUntil = 0;
  recent429Timestamps = [];
  rateLimitSummaryCount = 0;
  breakerSubscribed = false;
}

/** Pace a single UW HTTP call through local + optional Redis-global buckets. */
export async function throttleUw<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

/** Dedup identical in-flight GETs and pace through throttleUw. */
export async function throttleUwCoalesced<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = coalescedInflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = throttleUw(fn).finally(() => {
    coalescedInflight.delete(key);
  });
  coalescedInflight.set(key, promise);
  return promise;
}

/** Run UW tasks one-at-a-time (desk refresh / macro fetches). */
export async function runUwSequential<R extends readonly unknown[]>(
  tasks: { [K in keyof R]: () => Promise<R[K]> }
): Promise<R> {
  const results: unknown[] = [];
  for (const task of tasks) {
    results.push(await task());
  }
  return results as unknown as R;
}

/** Run UW tasks with a small concurrency pool. */
export async function runUwPool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = MAX_CONCURRENCY
): Promise<T[]> {
  if (!tasks.length) return [];
  const limit = Math.max(1, Math.min(concurrency, tasks.length));
  const out: T[] = new Array(tasks.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= tasks.length) return;
      out[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return out;
}

export function uwRateLimiterStats(): {
  maxRps: number;
  globalMaxRps: number;
  maxConcurrency: number;
  minSpacingMs: number;
  inFlight: number;
  tokens: number;
  redisGlobal: boolean;
  circuitOpen: boolean;
  circuitOpenUntil: number | null;
  recent429s: number;
} {
  refillTokens();
  const now = Date.now();
  recent429Timestamps = recent429Timestamps.filter((t) => now - t < SUMMARY_WINDOW_MS);
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
    recent429s: recent429Timestamps.length,
  };
}
