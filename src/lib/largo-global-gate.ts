// Pure, alias-free helpers for the CROSS-REPLICA Largo concurrency ceiling. No @/lib imports so the
// math + Lua are unit-testable under `tsx --test` (mirrors largo-local-gate.ts / ai-spend-ledger.ts).
// The route layer owns the Redis I/O + fail-open; this module is just keys, env parsing, the atomic
// Lua reservation script, and the staleness math.
//
// WHY this exists (audit §3.7): the per-user gate (max 2, largo/query/route.ts) and the per-process
// local backstop (largo-local-gate.ts) leave the GLOBAL in-flight count unbounded — 250 distinct
// premium users at 2 concurrent each = 500 simultaneous Claude tool-loops cluster-wide, each
// spending Anthropic tokens. This ceiling caps the org-wide concurrent Largo count in SHARED Redis,
// so a premium surge can't fan out unboundedly across replicas. It complements (does not replace)
// the per-user gate: per-user bounds one user, this bounds the whole cluster.
//
// LEAK-SAFE BY DESIGN: a plain INCR/DECR counter would drift UP forever if a replica crashed between
// acquire and release (the DECR never runs) — turning a cost guardrail into a permanent self-inflicted
// outage once the phantom count reached the cap. Instead this uses a ZSET keyed by request id and
// scored by acquire time: every acquire first prunes entries older than the max query lifetime, so a
// crashed reservation self-heals within one TTL window instead of leaking forever.

/** Redis key for the GLOBAL in-flight Largo reservation set (ZSET of reqId → acquire-time-ms). */
export const LARGO_INFLIGHT_KEY = "blackout:largo:inflight";

/** Default org-wide cap on simultaneous Largo queries when LARGO_GLOBAL_MAX_CONCURRENT is unset/invalid.
 *  Comfortably above the fail-open degraded ceiling (local backstop 6 × a few replicas), so the
 *  Redis-healthy ceiling is the looser of the two — a Redis OUTAGE is the more conservative state. */
export const DEFAULT_LARGO_GLOBAL_MAX_CONCURRENT = 40;

/** Read the env cap; falls back to the default for unset / non-numeric / <=0 values. */
export function largoGlobalMaxConcurrent(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.LARGO_GLOBAL_MAX_CONCURRENT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_LARGO_GLOBAL_MAX_CONCURRENT;
}

/** A reservation older than this (ms) is treated as LEAKED (the holding replica crashed before its
 *  release ran) and pruned on the next acquire, so the global count self-heals. MUST exceed the
 *  slowest plausible query — the route's maxDuration is 120s — with headroom. */
export const DEFAULT_LARGO_INFLIGHT_TTL_MS = 150_000;

/** Read the env reservation lifetime; falls back to the default for unset / non-numeric / <=0 values. */
export function largoInflightTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.LARGO_INFLIGHT_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_LARGO_INFLIGHT_TTL_MS;
}

/** Lowest score to KEEP on an acquire prune: reservations scored below (now − ttlMs) are leaked. */
export function inflightStaleCutoff(now: number, ttlMs: number): number {
  return now - ttlMs;
}

/**
 * Atomic ZSET concurrency reservation, evaluated in one round-trip (Redis's single thread serializes
 * it, so the count-then-reserve can't race across replicas).
 *   KEYS[1] = inflight ZSET key
 *   ARGV[1] = staleCutoff   (prune members scored below this — leaked reservations)
 *   ARGV[2] = cap           (max concurrent)
 *   ARGV[3] = now           (score for the new reservation)
 *   ARGV[4] = reqId         (member to reserve)
 *   ARGV[5] = keyTtlMs      (PEXPIRE so the key self-removes if ALL activity stops)
 * Returns 1 when a slot was reserved (caller MUST release reqId), 0 when at/over the cap.
 */
export const LARGO_INFLIGHT_ACQUIRE_LUA =
  "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); " +
  "if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end; " +
  "redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4]); " +
  "redis.call('PEXPIRE', KEYS[1], ARGV[5]); " +
  "return 1";
