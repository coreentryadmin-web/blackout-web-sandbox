/**
 * Shared primitives for UW + Polygon REST rate limiters.
 * Alias-free (no @/ imports) so computeDegradedLocalRps stays unit-testable via either limiter.
 */

export function rateLimiterEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function computeDegradedLocalRps(globalMaxRps: number, replicaCount: number): number {
  return Math.max(0.1, globalMaxRps / Math.max(1, Math.floor(replicaCount)));
}

/** Per-replica in-flight cap when the Redis cluster semaphore is unavailable. */
export function computeDegradedLocalConcurrency(
  globalMaxConcurrency: number,
  replicaCount: number
): number {
  return Math.max(1, Math.floor(globalMaxConcurrency / Math.max(1, Math.floor(replicaCount))));
}

export const REDIS_CONCURRENCY_ACQUIRE_LUA = `
local current = tonumber(redis.call('GET', KEYS[1])) or 0
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
if current >= limit then
  return 0
end
local next = redis.call('INCR', KEYS[1])
if next == 1 then
  redis.call('EXPIRE', KEYS[1], ttl)
end
return 1
`;

export const REDIS_CONCURRENCY_RELEASE_LUA = `
local current = tonumber(redis.call('GET', KEYS[1])) or 0
if current > 0 then
  redis.call('DECR', KEYS[1])
end
return 1
`;

/** Cluster-wide in-flight REST cap (UW Advanced hard limit is 3 concurrent). */
export async function acquireRedisConcurrencySlot(
  client: RateLimiterRedisClient,
  key: string,
  globalMaxConcurrency: number,
  leaseTtlSec = 120
): Promise<boolean> {
  const allowed = await client.eval(
    REDIS_CONCURRENCY_ACQUIRE_LUA,
    1,
    key,
    globalMaxConcurrency,
    leaseTtlSec
  );
  return allowed === 1;
}

export async function releaseRedisConcurrencySlot(
  client: RateLimiterRedisClient,
  key: string
): Promise<void> {
  try {
    await client.eval(REDIS_CONCURRENCY_RELEASE_LUA, 1, key);
  } catch {
    /* non-fatal — lease TTL clears stale counts */
  }
}

export type RateLimiterRedisClient = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
  disconnect(): void;
};

export const SLIDING_WINDOW_RATE_LIMIT_LUA = `
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

/** Atomic sliding-window Redis slot for a provider-specific key prefix. */
export async function acquireSlidingWindowRedisSlot(
  client: RateLimiterRedisClient,
  rpsKeyPrefix: string,
  globalMaxRps: number
): Promise<boolean> {
  const nowMs = Date.now();
  const sec = Math.floor(nowMs / 1000);
  const elapsedFrac = (nowMs % 1000) / 1000;
  const currKey = `${rpsKeyPrefix}:${sec}`;
  const prevKey = `${rpsKeyPrefix}:${sec - 1}`;
  const allowed = await client.eval(
    SLIDING_WINDOW_RATE_LIMIT_LUA,
    2,
    currKey,
    prevKey,
    elapsedFrac.toFixed(6),
    globalMaxRps,
    3
  );
  return allowed === 1;
}

export type BreakerSubscriptionState = { subscribed: boolean };

/**
 * Lazy passive subscriber: a peer breaker trip extends local pause.
 * Dynamic redis-pubsub import keeps limiter modules alias-free for unit tests.
 */
export function ensureProviderBreakerSubscription(
  state: BreakerSubscriptionState,
  channel: string,
  onPeerOpenUntil: (peerOpenUntil: number) => void
): void {
  if (state.subscribed) return;
  state.subscribed = true;
  void import("@/lib/redis-pubsub")
    .then(async ({ redisSubscribe }) => {
      const { subscribed } = await redisSubscribe(channel, (msg) => {
        try {
          const parsed = JSON.parse(msg) as { openUntil?: unknown };
          const peer = typeof parsed.openUntil === "number" ? parsed.openUntil : NaN;
          if (Number.isFinite(peer)) onPeerOpenUntil(peer);
        } catch {
          /* ignore malformed peer message */
        }
      });
      if (!subscribed) state.subscribed = false;
    })
    .catch(() => {
      state.subscribed = false;
    });
}
