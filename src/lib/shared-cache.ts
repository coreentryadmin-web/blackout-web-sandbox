type MemoryEntry = { value: string; expiresAt: number };

const memory = new Map<string, MemoryEntry>();

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
      const mod = await import("ioredis");
      const Redis = mod.default;
      const client = new Redis(process.env.REDIS_URL!.trim(), {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectTimeout: 2_000,
      });
      // Without an 'error' listener, ioredis throws on the EventEmitter when the
      // connection drops post-connect — which crashes the whole process/replica.
      client.on("error", (err) => console.warn("[shared-cache] redis error:", err instanceof Error ? err.message : err));
      await client.connect();
      redisClient = client;
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
  memory.set(key, { value: payload, expiresAt: Date.now() + ttlSec * 1000 });

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
