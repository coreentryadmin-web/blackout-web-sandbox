// Pure, alias-free per-user hunt concurrency-gate logic. No @/lib imports so it is
// unit-testable under `npx tsx --test` (mirrors largo-budget.ts / ai-spend.ts).
// The route layer (src/app/api/market/nighthawk/hunt/route.ts) owns Redis I/O +
// fail-open; this module is just keys, the cap, the Lua script, and the predicate.

/** Default max simultaneous hunts per user when HUNT_MAX_CONCURRENT is unset/invalid. */
export const DEFAULT_MAX_CONCURRENT_HUNTS = 2;

/** TTL (seconds) on the active-hunt counter so a crash mid-scan can never leave the
 *  user locked out — the key auto-expires. 180s comfortably exceeds maxDuration=120. */
export const HUNT_SLOT_TTL_S = 180;

/** Atomic acquire: INCR + EXPIRE in one round-trip so a crash between the two can never
 *  leave a counter with no TTL (which would lock the user out). Returns the post-incr count. */
export const HUNT_ACQUIRE_LUA =
  "local c = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[1]); return c";

/** Read the env cap; falls back to the default for unset / non-numeric / <=0 values. */
export function maxConcurrentHunts(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.HUNT_MAX_CONCURRENT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_CONCURRENT_HUNTS;
}

/** Redis key for a user's active-hunt counter. */
export function huntActiveKey(userId: string): string {
  return `hunt:active:${userId}`;
}

/** True when the post-incr count EXCEEDS the cap and this acquisition must be rejected
 *  (and decremented back). Matches acquireLargoSlot's `count > MAX` check semantics. */
export function shouldRejectHunt(postIncrCount: number, cap: number): boolean {
  return postIncrCount > cap;
}
