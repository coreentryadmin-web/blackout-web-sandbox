/**
 * Pure, alias-free merge for the cluster-aware Polygon circuit breaker.
 *
 * Mirrors uw-rate-limiter.mergeBreakerOpenUntil so the Polygon breaker can share its
 * OPEN-UNTIL deadline across replicas without any @/ import (keeps this helper + its
 * unit test resolvable under `tsx --test`).
 *
 * Given the current local deadline, a peer-published openUntil, the current clock, and
 * the max-future window, return the new deadline. Idempotent (Math.max), so a replica
 * receiving its own trip is harmless — no INSTANCE_ID needed. Clamps any peer value
 * beyond now+maxFutureMs (poison guard) and ignores non-finite / past values (returns
 * current unchanged).
 */
export function mergePolyBreakerOpenUntil(
  current: number,
  peerOpenUntil: number,
  now: number,
  maxFutureMs: number
): number {
  if (!Number.isFinite(peerOpenUntil) || peerOpenUntil <= now) return current;
  const clamped = Math.min(peerOpenUntil, now + maxFutureMs);
  return Math.max(current, clamped);
}
