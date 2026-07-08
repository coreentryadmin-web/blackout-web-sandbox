/** UW API throttle — token bucket, min spacing, in-flight dedup, circuit breaker. */

import { tryClaimHuntUwCall, UwHuntBudgetExhaustedError } from "./uw-hunt-budget";
import {
  rateLimiterEnvNumber,
  computeDegradedLocalRps,
  computeDegradedLocalConcurrency,
  type RateLimiterRedisClient,
  acquireSlidingWindowRedisSlot,
  acquireRedisConcurrencySlot,
  releaseRedisConcurrencySlot,
  ensureProviderBreakerSubscription,
  type BreakerSubscriptionState,
} from "./provider-rate-limiter-shared";

export { computeDegradedLocalRps, computeDegradedLocalConcurrency } from "./provider-rate-limiter-shared";

const envNumber = rateLimiterEnvNumber;

/** Per-process pacing; default 2 rps. Override via UW_MAX_RPS (e.g. lower on the worker
 *  than on web when no Redis-global ceiling is in play). */
const MAX_RPS = envNumber("UW_MAX_RPS", 2);
/** Cluster-wide ceiling when REDIS_URL is set — shared by worker + web app. */
const GLOBAL_MAX_RPS = envNumber("UW_GLOBAL_MAX_RPS", 2);
/** Live replica count of this service — divides the global budget across replicas on Redis loss. */
const REPLICA_COUNT = Math.max(1, Math.floor(envNumber("REPLICA_COUNT", 1)));

/**
 * Per-replica RPS the local bucket may sustain when the Redis global ceiling is UNAVAILABLE.
 * With Redis up, the atomic Lua ceiling is the real cluster cap and the local bucket is just a
 * smoother (full MAX_RPS, so a busy replica can use the whole budget when peers are idle). With
 * Redis DOWN (fail-open) the local bucket is the ONLY cap, so N replicas each pacing at MAX_RPS
 * would emit N*MAX_RPS and breach the hard UW ceiling (deep-dive gap #1). Dividing GLOBAL/ N gives
 * an EXACT cluster cap of GLOBAL_MAX_RPS. Fractional on purpose: clamping floor(2/3)→1 would breach
 * at N>2, and a true floor(2/3)=0 would starve. The 0.1 guard only protects a misconfigured-high
 * REPLICA_COUNT from total starvation; for realistic N (≤~20) the cluster cap stays exact.
 */
const DEGRADED_LOCAL_RPS = computeDegradedLocalRps(GLOBAL_MAX_RPS, REPLICA_COUNT);
/** UW Advanced hard limit: 3 concurrent REST calls per API key cluster-wide. */
const GLOBAL_MAX_CONCURRENCY = Math.max(1, Math.floor(envNumber("UW_GLOBAL_MAX_CONCURRENCY", 2)));
const DEGRADED_LOCAL_CONCURRENCY = computeDegradedLocalConcurrency(
  GLOBAL_MAX_CONCURRENCY,
  REPLICA_COUNT
);
const MAX_CONCURRENCY = Math.max(1, Math.floor(envNumber("UW_MAX_CONCURRENCY", 3)));
const UW_CONCURRENCY_REDIS_KEY = "blackout:uw:concurrency";
const MIN_SPACING_MS = Math.max(0, Math.floor(envNumber("UW_MIN_SPACING_MS", 300)));
const CIRCUIT_429_THRESHOLD = Math.max(3, Math.floor(envNumber("UW_CIRCUIT_429_THRESHOLD", 8)));
const CIRCUIT_PAUSE_MS = Math.max(10_000, Math.floor(envNumber("UW_CIRCUIT_PAUSE_MS", 45_000)));

const SUMMARY_WINDOW_MS = 60_000;

let tokens = MAX_RPS;
let lastRefillMs = Date.now();
let lastStartMs = 0;
let inFlight = 0;
let redisConcurrencyHeld = false;

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
const breakerSubState: BreakerSubscriptionState = { subscribed: false };

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
  ensureProviderBreakerSubscription(breakerSubState, BREAKER_CHANNEL, (peer) => {
    circuitOpenUntil = mergeBreakerOpenUntil(circuitOpenUntil, peer, Date.now());
  });
}

const coalescedInflight = new Map<string, Promise<unknown>>();

type RedisClient = RateLimiterRedisClient;

let sharedRedis: RedisClient | null = null;
let sharedRedisFailedAt = 0;
const SHARED_REDIS_RETRY_BACKOFF_MS = 30_000;

/**
 * Fire-ONCE latch for the "Redis ceiling degraded" ops alert. The cluster-wide UW limiter loses its
 * authoritative Redis ceiling when sharedRedisFailedAt is armed; previously that degraded flag lived
 * ONLY in /api/admin/health JSON and never alerted (audit #8/#78). We page ops exactly once on the
 * transition INTO the degraded state (not per hot-path call) and re-arm the latch on recovery so a
 * later re-degrade alerts again. Multi-replica only matters here: REPLICA_COUNT must be set or the
 * cluster can overshoot the upstream UW ceiling while degraded.
 */
let redisDegradedAlerted = false;

/** Page ops once when the limiter enters the degraded (no-Redis-ceiling) state. Fire-and-forget via a
 *  lazy dynamic import (keeps this module's alias-free unit-test purity, mirrors the breaker pub/sub).
 *  No-ops while already latched; re-armed by clearAlertOnRedisRecovery() on the next healthy slot. */
function alertRedisDegradedOnce(): void {
  if (redisDegradedAlerted) return;
  redisDegradedAlerted = true;
  // Only meaningful as a hard overshoot risk when we actually divide the budget (N>1). A single
  // replica on local pacing IS the whole cluster, so full MAX_RPS is correct and not an alert.
  if (REPLICA_COUNT <= 1) return;
  void import("@/features/spx/lib/spx-play-notify")
    .then(({ notifyOpsDiscord }) =>
      notifyOpsDiscord({
        title: "UW rate-limiter DEGRADED — Redis ceiling unavailable",
        body:
          `The cluster-wide UW Redis ceiling is unreachable, so each replica fell back to per-replica ` +
          `pacing (${DEGRADED_LOCAL_RPS.toFixed(2)} rps, REPLICA_COUNT=${REPLICA_COUNT}). If REPLICA_COUNT ` +
          `is unset/stale the cluster can overshoot the upstream UW cap. Auto-retries every ` +
          `${Math.round(SHARED_REDIS_RETRY_BACKOFF_MS / 1000)}s; this alerts once until Redis recovers.`,
        severity: "warning",
      })
    )
    .catch(() => {
      redisDegradedAlerted = false; // alert never delivered — allow a later retry
    });
}

/** Re-arm the once-latch when the Redis ceiling comes back, so a future re-degrade alerts again. */
function clearAlertOnRedisRecovery(): void {
  redisDegradedAlerted = false;
}

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
    const { makeRedis } = await import("../make-redis");
    const client = await makeRedis("uw-rate-limiter", url, { maxRetriesPerRequest: 1 });
    sharedRedis = client as unknown as RedisClient;
    sharedRedisFailedAt = 0; // clear failure on success
    clearAlertOnRedisRecovery(); // Redis ceiling restored → re-arm the degraded once-latch
    return sharedRedis;
  } catch {
    sharedRedisFailedAt = Date.now();
    alertRedisDegradedOnce(); // page ops once on the transition into the degraded state
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

/** Per-replica in-flight cap — Redis semaphore is the cluster gate when healthy. */
function effectiveMaxConcurrency(): number {
  return redisGlobalActive() ? MAX_CONCURRENCY : DEGRADED_LOCAL_CONCURRENCY;
}

function refillTokens(): void {
  const now = Date.now();
  const elapsedSec = (now - lastRefillMs) / 1000;
  if (elapsedSec <= 0) return;
  const rate = effectiveMaxRps();
  // Burst capacity is >=1 so a call can always eventually admit even when the sustained rate is
  // fractional (e.g. 2 RPS / 3 replicas = 0.67); the refill RATE is what paces the long run.
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

async function acquireGlobalRedisConcurrencySlot(): Promise<boolean> {
  const client = await getSharedRedis();
  if (!client) return true;

  try {
    return await acquireRedisConcurrencySlot(
      client,
      UW_CONCURRENCY_REDIS_KEY,
      GLOBAL_MAX_CONCURRENCY
    );
  } catch {
    sharedRedisFailedAt = Date.now();
    alertRedisDegradedOnce();
    const dead = sharedRedis;
    sharedRedis = null;
    try {
      dead?.disconnect();
    } catch {
      /* ignore */
    }
    console.warn(
      `[uw] Redis concurrency semaphore unavailable — degraded to ${DEGRADED_LOCAL_CONCURRENCY} in-flight per replica (REPLICA_COUNT=${REPLICA_COUNT}).`
    );
    return true;
  }
}

async function acquireGlobalRedisSlot(): Promise<boolean> {
  const client = await getSharedRedis();
  if (!client) return true;

  try {
    return await acquireSlidingWindowRedisSlot(client, "blackout:uw:rps", GLOBAL_MAX_RPS);
  } catch {
    // Redis died mid-session: arm the backoff so getSharedRedis() falls back to
    // local-only pacing for SHARED_REDIS_RETRY_BACKOFF_MS instead of awaiting a
    // dead client on every hot-path call. Tear down the old client (ioredis would
    // otherwise keep auto-reconnecting in the background).
    sharedRedisFailedAt = Date.now();
    alertRedisDegradedOnce(); // page ops once on the transition into the degraded state
    const dead = sharedRedis;
    sharedRedis = null;
    try { dead?.disconnect(); } catch { /* ignore */ }
    // Degraded mode: the global ceiling is gone, so the local bucket now paces at the per-replica
    // DEGRADED_LOCAL_RPS budget. REPLICA_COUNT MUST be set for N>1 or the cluster can still
    // overshoot. Logged ~once per backoff window (not per call) since getSharedRedis short-circuits.
    console.warn(
      `[uw] Redis ceiling unavailable — degraded to per-replica pacing ${DEGRADED_LOCAL_RPS.toFixed(
        2
      )} rps (REPLICA_COUNT=${REPLICA_COUNT}). Set REPLICA_COUNT to the live replica count.`
    );
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
  const concurrencyCap = effectiveMaxConcurrency();
  for (;;) {
    refillTokens();
    if (inFlight < concurrencyCap && tokens >= 1) {
      // Reserve the slot synchronously BEFORE pacing so no concurrent acquirer can
      // observe the un-consumed token/concurrency across the await and overshoot MAX_RPS.
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
    const delay = inFlight >= concurrencyCap ? 50 : waitMsForToken();
    await new Promise((r) => setTimeout(r, delay));
  }
}

async function acquireSlot(): Promise<void> {
  ensureBreakerSubscription();
  await waitForCircuit();
  if (process.env.REDIS_URL?.trim()) {
    for (;;) {
      if (!(await acquireGlobalRedisSlot())) {
        await new Promise((r) => setTimeout(r, 40));
        continue;
      }
      if (!(await acquireGlobalRedisConcurrencySlot())) {
        await new Promise((r) => setTimeout(r, 40));
        continue;
      }
      redisConcurrencyHeld = true;
      await acquireLocalSlot();
      return;
    }
  }
  await acquireLocalSlot();
}

function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
  if (!redisConcurrencyHeld) return;
  redisConcurrencyHeld = false;
  void getSharedRedis()
    .then((client) => {
      if (!client) return;
      return releaseRedisConcurrencySlot(client, UW_CONCURRENCY_REDIS_KEY);
    })
    .catch(() => {});
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
  breakerSubState.subscribed = false;
}

/** Pace a single UW HTTP call through local + optional Redis-global buckets. */
export async function throttleUw<T>(fn: () => Promise<T>): Promise<T> {
  // Hunt-budget gate (cache-reader rule): when a Night Hawk hunt is running, a GENUINE
  // live UW call must first claim a token from the per-hunt budget. Once spent, throw
  // BEFORE touching acquireSlot() so an exhausted hunt never queues on — let alone
  // monopolizes — the shared 2-RPS limiter that the live SPX desk depends on. Inert
  // outside a hunt context (tryClaimHuntUwCall returns true), so the desk/crons are
  // unaffected. The hunt's fetch wrappers catch this sentinel and serve cached/empty.
  if (!tryClaimHuntUwCall()) {
    throw new UwHuntBudgetExhaustedError();
  }
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

/**
 * Tuple-typed variant of runUwPool — same heterogeneous-results signature as
 * runUwSequential, but overlaps the HTTP round-trips through a small pool.
 * Every task still paces through throttleUw/acquireSlot (2-RPS + concurrency
 * caps), so this changes WAITING, not RATE: sequential execution adds each
 * call's full latency between limiter slots (the audit measured ≥3.6s of pure
 * dead time on buildSpxDesk's 12-call cold path); a pool keeps the limiter's
 * schedule saturated instead. Use for latency-critical lanes (live SPX desk);
 * batch jobs (nighthawk dossiers) can stay on runUwSequential.
 */
export async function runUwPooled<R extends readonly unknown[]>(
  tasks: { [K in keyof R]: () => Promise<R[K]> },
  concurrency = MAX_CONCURRENCY
): Promise<R> {
  const out = await runUwPool(
    tasks as unknown as Array<() => Promise<unknown>>,
    concurrency
  );
  return out as unknown as R;
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
  replicaCount: number;
  degradedLocalRps: number;
  globalMaxConcurrency: number;
  degradedLocalConcurrency: number;
  maxConcurrency: number;
  minSpacingMs: number;
  inFlight: number;
  tokens: number;
  redisGlobal: boolean;
  degraded: boolean;
  circuitOpen: boolean;
  circuitOpenUntil: number | null;
  recent429s: number;
} {
  refillTokens();
  const now = Date.now();
  recent429Timestamps = recent429Timestamps.filter((t) => now - t < SUMMARY_WINDOW_MS);
  const redisGlobal = redisGlobalActive();
  return {
    maxRps: MAX_RPS,
    globalMaxRps: GLOBAL_MAX_RPS,
    replicaCount: REPLICA_COUNT,
    degradedLocalRps: DEGRADED_LOCAL_RPS,
    globalMaxConcurrency: GLOBAL_MAX_CONCURRENCY,
    degradedLocalConcurrency: DEGRADED_LOCAL_CONCURRENCY,
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
    recent429s: recent429Timestamps.length,
  };
}
