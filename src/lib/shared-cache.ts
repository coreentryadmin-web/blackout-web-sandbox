type MemoryEntry = { value: string; expiresAt: number };

const memory = new Map<string, MemoryEntry>();

// The in-memory map is the Redis-FALLBACK copy, written on EVERY sharedCacheSet (even when Redis is
// up). Previously it was never swept (audit §3.3) — quote:/nw:optmark:/server: keys accumulated for
// the whole process lifetime. Bound it with the same insertion-order LRU + sweep-on-cap pattern as
// server-cache.ts:setStoreEntry.
const MAX_MEMORY_ENTRIES = 5_000;

function setMemoryEntry(key: string, entry: MemoryEntry): void {
  memory.delete(key); // re-insert → most-recently-used position, so hot keys aren't evicted as "oldest"
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of Array.from(memory)) {
      if (v.expiresAt <= now) memory.delete(k); // reclaim expired before evicting live keys
    }
    while (memory.size >= MAX_MEMORY_ENTRIES) {
      const oldest = memory.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      memory.delete(oldest);
    }
  }
  memory.set(key, entry);
}

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttlSec: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
};

let redisClient: RedisClient | null | undefined;
let redisInitPromise: Promise<RedisClient | null> | null = null;
// Track last failure time instead of a permanent flag; retry after backoff.
const RETRY_BACKOFF_MS = 30_000;
let lastFailedAt = 0;

function redisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

async function getRedis(): Promise<RedisClient | null> {
  if (!redisEnabled()) return null;
  if (redisClient) return redisClient;
  // If a recent failure is within the backoff window, skip retry.
  if (lastFailedAt && Date.now() - lastFailedAt < RETRY_BACKOFF_MS) return null;
  if (redisInitPromise) return redisInitPromise;

  redisInitPromise = (async () => {
    try {
      const { makeRedis } = await import("./make-redis");
      const client = await makeRedis("shared-cache", process.env.REDIS_URL!.trim(), {
        maxRetriesPerRequest: 1,
      });
      redisClient = client as unknown as RedisClient;
      lastFailedAt = 0; // clear failure on success
      return redisClient;
    } catch (error) {
      lastFailedAt = Date.now();
      redisInitPromise = null; // allow retry after backoff
      console.warn("[shared-cache] Redis unavailable — using in-memory fallback", error);
      return null;
    }
  })();

  return redisInitPromise;
}

export async function sharedCacheGet<T>(key: string): Promise<T | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redis.get(`blackout:${key}`);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      // fall through to memory
    }
  }

  const hit = memory.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return JSON.parse(hit.value) as T;
  }
  return null;
}

/**
 * Like sharedCacheGet but also returns the remaining TTL in seconds from Redis
 * (-1 means no expiry, -2 means key not found, null means Redis unavailable).
 * Used by server-cache to re-seed the in-memory layer with the correct remaining TTL.
 */
export async function sharedCacheGetWithTtl<T>(
  key: string
): Promise<{ value: T; remainingTtlSec: number } | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      const redisKey = `blackout:${key}`;
      const [raw, ttl] = await Promise.all([redis.get(redisKey), redis.ttl(redisKey)]);
      if (raw && ttl > 0) {
        return { value: JSON.parse(raw) as T, remainingTtlSec: ttl };
      }
    } catch {
      // fall through to memory
    }
  }

  const hit = memory.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    const remainingTtlSec = Math.max(1, Math.round((hit.expiresAt - Date.now()) / 1000));
    return { value: JSON.parse(hit.value) as T, remainingTtlSec };
  }
  return null;
}

export async function sharedCacheSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  const payload = JSON.stringify(value);
  setMemoryEntry(key, { value: payload, expiresAt: Date.now() + ttlSec * 1000 });

  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.set(`blackout:${key}`, payload, "EX", ttlSec);
  } catch {
    // memory copy already stored
  }
}

/** Desk sticky lanes — GEX walls, unified tape, gamma flip (cross-instance when Redis is set). */
export const DESK_STICKY_KEYS = {
  gexWalls: "desk:sticky:gex_walls",
  strikeLevels: "desk:sticky:strike_levels",
  gammaFlip: "desk:sticky:gamma_flip",
  gammaRegime: "desk:sticky:gamma_regime",
  unifiedTape: "desk:sticky:unified_tape",
  spxFlowBriefs: "desk:sticky:spx_flow_briefs",
} as const;

export const DESK_STICKY_TTL_SEC = {
  gex: Number(process.env.SPX_REDIS_GEX_TTL_SEC ?? 120),
  tape: Number(process.env.SPX_REDIS_TAPE_TTL_SEC ?? 60),
} as const;
