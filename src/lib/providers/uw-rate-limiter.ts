/** UW API throttle — per-process token bucket + optional Redis global RPS cap. */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per-process pacing (worker should set lower than web if no Redis). */
const MAX_RPS = envNumber("UW_MAX_RPS", 2.5);
/** Cluster-wide ceiling when REDIS_URL is set — shared by worker + web app. */
const GLOBAL_MAX_RPS = envNumber("UW_GLOBAL_MAX_RPS", 2.5);
const MAX_CONCURRENCY = Math.max(1, Math.floor(envNumber("UW_MAX_CONCURRENCY", 4)));

let tokens = MAX_RPS;
let lastRefillMs = Date.now();
let inFlight = 0;

type RedisClient = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  disconnect(): void;
};

let sharedRedis: RedisClient | null = null;
let sharedRedisFailed = false;

async function getSharedRedis(): Promise<RedisClient | null> {
  if (sharedRedisFailed) return null;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (sharedRedis) return sharedRedis;

  try {
    const mod = await import("ioredis");
    const Redis = mod.default;
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 2_000,
    });
    await client.connect();
    sharedRedis = client as unknown as RedisClient;
    return sharedRedis;
  } catch {
    sharedRedisFailed = true;
    return null;
  }
}

function refillTokens(): void {
  const now = Date.now();
  const elapsedSec = (now - lastRefillMs) / 1000;
  if (elapsedSec <= 0) return;
  tokens = Math.min(MAX_RPS, tokens + elapsedSec * MAX_RPS);
  lastRefillMs = now;
}

function waitMsForToken(): number {
  refillTokens();
  if (tokens >= 1) return 0;
  const deficit = 1 - tokens;
  return Math.max(25, Math.ceil((deficit / MAX_RPS) * 1000));
}

async function acquireGlobalRedisSlot(): Promise<boolean> {
  const client = await getSharedRedis();
  if (!client) return true;

  const second = Math.floor(Date.now() / 1000);
  const key = `blackout:uw:rps:${second}`;
  try {
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, 3);
    return count <= Math.ceil(GLOBAL_MAX_RPS);
  } catch {
    return true;
  }
}

async function acquireLocalSlot(): Promise<void> {
  for (;;) {
    refillTokens();
    if (inFlight < MAX_CONCURRENCY && tokens >= 1) {
      tokens -= 1;
      inFlight += 1;
      return;
    }
    const delay = inFlight >= MAX_CONCURRENCY ? 50 : waitMsForToken();
    await new Promise((r) => setTimeout(r, delay));
  }
}

async function acquireSlot(): Promise<void> {
  if (process.env.REDIS_URL?.trim()) {
    for (;;) {
      if (await acquireGlobalRedisSlot()) {
        await acquireLocalSlot();
        return;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  await acquireLocalSlot();
}

function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
}

/** Pace a single UW HTTP call through local + optional Redis-global buckets. */
export async function throttleUw<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

export function uwRateLimiterStats(): {
  maxRps: number;
  globalMaxRps: number;
  maxConcurrency: number;
  inFlight: number;
  tokens: number;
  redisGlobal: boolean;
} {
  refillTokens();
  return {
    maxRps: MAX_RPS,
    globalMaxRps: GLOBAL_MAX_RPS,
    maxConcurrency: MAX_CONCURRENCY,
    inFlight,
    tokens,
    redisGlobal: Boolean(process.env.REDIS_URL?.trim()) && !sharedRedisFailed,
  };
}
