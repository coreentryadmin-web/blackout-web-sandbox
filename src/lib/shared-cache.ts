type MemoryEntry = { value: string; expiresAt: number };

const memory = new Map<string, MemoryEntry>();

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttlSec: number): Promise<unknown>;
};

let redisClient: RedisClient | null | undefined;
let redisInitFailed = false;

function redisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

async function getRedis(): Promise<RedisClient | null> {
  if (!redisEnabled()) return null;
  if (redisInitFailed) return null;
  if (redisClient) return redisClient;

  try {
    const mod = await import("ioredis");
    const Redis = mod.default;
    const client = new Redis(process.env.REDIS_URL!.trim(), {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 2_000,
    });
    await client.connect();
    redisClient = client;
    return redisClient;
  } catch (error) {
    redisInitFailed = true;
    console.warn("[shared-cache] Redis unavailable — using in-memory fallback", error);
    return null;
  }
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
