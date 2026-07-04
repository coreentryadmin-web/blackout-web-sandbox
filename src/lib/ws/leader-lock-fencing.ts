/**
 * Fencing helpers for the Redis SETNX-based cluster leader locks in uw-socket.ts,
 * polygon-socket.ts, options-socket.ts, and stocks-socket.ts.
 *
 * Plain "SET key '1' NX EX ttl" acquire plus unconditional "EXPIRE"/"DEL" renew/release has a
 * split-brain hole: if a leader stalls past the lock's TTL (GC pause, blocking call, event-loop
 * backlog), a standby's SETNX can win the lock while the stalled replica is still alive and will
 * resume. When the stalled replica's renewal timer next fires, it blindly re-arms the TTL on
 * whatever now occupies the key — even though that key is now owned by a DIFFERENT replica. Both
 * replicas then believe they hold leadership indefinitely, with no signal anything is wrong, and
 * both open a live WebSocket to an upstream that permits only one connection per API key.
 *
 * Fencing closes this: each acquirer writes a random per-process token instead of a constant "1",
 * and renew/release only touch the key if it still holds THAT token — checked and acted on
 * atomically via a Lua script so there is no read-then-write race with a concurrent acquirer.
 */
import { randomUUID } from "node:crypto";

export function newLockToken(): string {
  return randomUUID();
}

// KEYS[1] = lock key, ARGV[1] = my token, ARGV[2] = ttl seconds.
// Returns 1 if renewed, 0 if the lock no longer holds my token (another replica already won it —
// the caller must treat this as "leadership lost" and stand down instead of continuing to run).
const RENEW_IF_MINE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end';

// KEYS[1] = lock key, ARGV[1] = my token.
// Returns 1 if deleted, 0 if the lock was already someone else's — never delete a lock this
// process doesn't currently own, which would hand leadership to nobody mid-lease.
const RELEASE_IF_MINE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export type FencedRedis = {
  eval(script: string, numkeys: number, ...args: Array<string | number>): Promise<unknown>;
};

/** Renews the lock's TTL only if it still holds `token`. Returns false if leadership was lost. */
export async function renewFencedLock(
  redis: FencedRedis,
  key: string,
  token: string,
  ttlSec: number
): Promise<boolean> {
  const result = await redis.eval(RENEW_IF_MINE_SCRIPT, 1, key, token, ttlSec);
  return result === 1;
}

/** Releases the lock only if it still holds `token` — a no-op if leadership already moved on. */
export async function releaseFencedLock(redis: FencedRedis, key: string, token: string): Promise<void> {
  await redis.eval(RELEASE_IF_MINE_SCRIPT, 1, key, token);
}
