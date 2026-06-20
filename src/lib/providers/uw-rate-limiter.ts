/** UW API throttle — token bucket, min spacing, in-flight dedup, circuit breaker. */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per-process pacing (worker should set lower than web if no Redis). */
const MAX_RPS = envNumber("UW_MAX_RPS", 2);
/** Cluster-wide ceiling when REDIS_URL is set — shared by worker + web app. */
const GLOBAL_MAX_RPS = envNumber("UW_GLOBAL_MAX_RPS", 2);
const MAX_CONCURRENCY = Math.max(1, Math.floor(envNumber("UW_MAX_CONCURRENCY", 3)));
const MIN_SPACING_MS = Math.max(0, Math.floor(envNumber("UW_MIN_SPACING_MS", 300)));
const CIRCUIT_429_THRESHOLD = Math.max(3, Math.floor(envNumber("UW_CIRCUIT_429_THRESHOLD", 8)));
const CIRCUIT_PAUSE_MS = Math.max(10_000, Math.floor(envNumber("UW_CIRCUIT_PAUSE_MS", 45_000)));

const SUMMARY_WINDOW_MS = 60_000;

let tokens = MAX_RPS;
let lastRefillMs = Date.now();
let lastStartMs = 0;
let inFlight = 0;

let circuitOpenUntil = 0;
let recent429Timestamps: number[] = [];
let rateLimitSummaryCount = 0;
let rateLimitSummaryWindowStart = Date.now();

const coalescedInflight = new Map<string, Promise<unknown>>();

type RedisClient = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
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

  const nowMs = Date.now();
  const sec = Math.floor(nowMs / 1000);
  const elapsedFrac = (nowMs % 1000) / 1000;
  const currKey = `blackout:uw:rps:${sec}`;
  const prevKey = `blackout:uw:rps:${sec - 1}`;

  try {
    const [currRaw, prevRaw] = await Promise.all([client.get(currKey), client.get(prevKey)]);
    const curr = Number(currRaw ?? 0);
    const prev = Number(prevRaw ?? 0);
    const estimated = curr + prev * (1 - elapsedFrac);
    if (estimated >= GLOBAL_MAX_RPS) return false;

    const count = await client.incr(currKey);
    if (count === 1) await client.expire(currKey, 3);
    return true;
  } catch {
    return true;
  }
}

async function waitForCircuit(): Promise<void> {
  for (;;) {
    const now = Date.now();
    if (now >= circuitOpenUntil) return;
    await new Promise((r) => setTimeout(r, Math.min(500, circuitOpenUntil - now)));
  }
}

async function waitMinSpacing(): Promise<void> {
  if (MIN_SPACING_MS <= 0) return;
  const now = Date.now();
  const wait = MIN_SPACING_MS - (now - lastStartMs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStartMs = Date.now();
}

async function acquireLocalSlot(): Promise<void> {
  for (;;) {
    refillTokens();
    if (inFlight < MAX_CONCURRENCY && tokens >= 1) {
      await waitMinSpacing();
      tokens -= 1;
      inFlight += 1;
      return;
    }
    const delay = inFlight >= MAX_CONCURRENCY ? 50 : waitMsForToken();
    await new Promise((r) => setTimeout(r, delay));
  }
}

async function acquireSlot(): Promise<void> {
  await waitForCircuit();
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

function maybeFlushRateLimitSummary(now: number): void {
  if (now - rateLimitSummaryWindowStart < SUMMARY_WINDOW_MS) return;
  if (rateLimitSummaryCount > 0) {
    console.warn(`[uw] ${rateLimitSummaryCount} rate-limited endpoints in last 60s`);
  }
  rateLimitSummaryCount = 0;
  rateLimitSummaryWindowStart = now;
}

/** Stable cache/dedup key for a UW GET. */
export function buildUwRequestKey(path: string, params: Record<string, string | number> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const sorted = Array.from(qs.entries()).sort(([a], [b]) => a.localeCompare(b));
  const q = new URLSearchParams(sorted).toString();
  return q ? `${path}?${q}` : path;
}

/** True while circuit breaker is pausing new UW HTTP calls. */
export function isUwCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

/** Record a 429 — may open circuit breaker and aggregate log summary. */
export function noteUw429(_path?: string): void {
  const now = Date.now();
  recent429Timestamps = recent429Timestamps.filter((t) => now - t < SUMMARY_WINDOW_MS);
  recent429Timestamps.push(now);
  rateLimitSummaryCount += 1;

  if (recent429Timestamps.length >= CIRCUIT_429_THRESHOLD && now >= circuitOpenUntil) {
    circuitOpenUntil = now + CIRCUIT_PAUSE_MS;
    console.warn(
      `[uw] circuit breaker open ${Math.round(CIRCUIT_PAUSE_MS / 1000)}s (${recent429Timestamps.length} 429s in 60s)`
    );
  }
  maybeFlushRateLimitSummary(now);
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

/** Dedup identical in-flight GETs and pace through throttleUw. */
export async function throttleUwCoalesced<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = coalescedInflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = throttleUw(fn).finally(() => {
    coalescedInflight.delete(key);
  });
  coalescedInflight.set(key, promise);
  return promise;
}

/** Run UW tasks one-at-a-time (desk refresh / macro fetches). */
export async function runUwSequential<R extends readonly unknown[]>(
  tasks: { [K in keyof R]: () => Promise<R[K]> }
): Promise<R> {
  const results: unknown[] = [];
  for (const task of tasks) {
    results.push(await task());
  }
  return results as unknown as R;
}

/** Run UW tasks with a small concurrency pool. */
export async function runUwPool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = MAX_CONCURRENCY
): Promise<T[]> {
  if (!tasks.length) return [];
  const limit = Math.max(1, Math.min(concurrency, tasks.length));
  const out: T[] = new Array(tasks.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= tasks.length) return;
      out[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return out;
}

export function uwRateLimiterStats(): {
  maxRps: number;
  globalMaxRps: number;
  maxConcurrency: number;
  minSpacingMs: number;
  inFlight: number;
  tokens: number;
  redisGlobal: boolean;
  circuitOpen: boolean;
  circuitOpenUntil: number | null;
  recent429s: number;
} {
  refillTokens();
  const now = Date.now();
  recent429Timestamps = recent429Timestamps.filter((t) => now - t < SUMMARY_WINDOW_MS);
  return {
    maxRps: MAX_RPS,
    globalMaxRps: GLOBAL_MAX_RPS,
    maxConcurrency: MAX_CONCURRENCY,
    minSpacingMs: MIN_SPACING_MS,
    inFlight,
    tokens,
    redisGlobal: Boolean(process.env.REDIS_URL?.trim()) && !sharedRedisFailed,
    circuitOpen: now < circuitOpenUntil,
    circuitOpenUntil: now < circuitOpenUntil ? circuitOpenUntil : null,
    recent429s: recent429Timestamps.length,
  };
}
