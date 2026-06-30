// Pure, alias-free helpers for the CROSS-REPLICA Night Hawk hunt concurrency ceiling. No @/lib
// imports so the math + Lua are unit-testable under `tsx --test` (mirrors largo-global-gate.ts).
// The route layer owns the Redis I/O + fail-open; this module is just keys, env parsing, the atomic
// Lua reservation script, and the staleness math.
//
// WHY this exists (audit §3.7): the per-user hunt gate (max 2, nighthawk/hunt/route.ts) leaves the
// GLOBAL in-flight hunt count unbounded — many premium users each running 2 concurrent scans can
// fan out expensive multi-provider agent work cluster-wide. This ceiling caps org-wide concurrent
// hunts in SHARED Redis. It complements (does not replace) the per-user gate.
//
// LEAK-SAFE BY DESIGN: same ZSET + staleCutoff prune pattern as largo-global-gate — a crashed
// replica's reservation self-heals within one TTL window instead of leaking forever.

/** Redis key for the GLOBAL in-flight hunt reservation set (ZSET of reqId → acquire-time-ms). */
export const HUNT_INFLIGHT_KEY = "blackout:hunt:inflight";

/** Default org-wide cap on simultaneous hunts when HUNT_GLOBAL_MAX_CONCURRENT is unset/invalid. */
export const DEFAULT_HUNT_GLOBAL_MAX_CONCURRENT = 24;

/** Read the env cap; falls back to the default for unset / non-numeric / <=0 values. */
export function huntGlobalMaxConcurrent(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.HUNT_GLOBAL_MAX_CONCURRENT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_HUNT_GLOBAL_MAX_CONCURRENT;
}

/** A reservation older than this (ms) is treated as LEAKED and pruned on the next acquire.
 *  MUST exceed maxDuration (120s) with headroom. */
export const DEFAULT_HUNT_INFLIGHT_TTL_MS = 150_000;

/** Read the env reservation lifetime; falls back to the default for unset / non-numeric / <=0 values. */
export function huntInflightTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.HUNT_INFLIGHT_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_HUNT_INFLIGHT_TTL_MS;
}

/** Lowest score to KEEP on an acquire prune: reservations scored below (now − ttlMs) are leaked. */
export function huntInflightStaleCutoff(now: number, ttlMs: number): number {
  return now - ttlMs;
}

/**
 * Atomic ZSET concurrency reservation — same Lua as Largo global gate (prune → count → reserve).
 * Returns 1 when a slot was reserved (caller MUST release reqId), 0 when at/over the cap.
 */
export const HUNT_INFLIGHT_ACQUIRE_LUA =
  "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); " +
  "if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end; " +
  "redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4]); " +
  "redis.call('PEXPIRE', KEYS[1], ARGV[5]); " +
  "return 1";
