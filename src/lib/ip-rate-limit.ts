/**
 * Per-IP fixed-window rate limiter backed by Redis.
 *
 * Fails open: if Redis is unavailable, all requests are allowed. This is the
 * correct trade-off for a trading platform where a Redis blip should never
 * block a paying user from accessing data.
 *
 * Usage in a route handler:
 *   const ip = getClientIp(req);
 *   const { ok, remaining } = await checkIpRateLimit(ip, "public:track-record", 30, 60);
 *   if (!ok) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
 */

import type { NextRequest } from "next/server";

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
};

/**
 * Extract the real client IP from a proxied request.
 * Cloudflare sets CF-Connecting-IP; Railway/generic proxies use x-forwarded-for.
 * Falls back to a sentinel so the limiter still works (won't rate-limit by IP, but
 * won't crash either — keeps the fail-open contract).
 */
export function getClientIp(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf?.trim()) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  const xri = req.headers.get("x-real-ip");
  if (xri?.trim()) return xri.trim();
  return "unknown";
}

type RedisLike = {
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
  quit(): Promise<unknown>;
};

// Lua script: atomic fixed-window check-and-increment.
// KEYS[1] = counter key; ARGV[1] = limit; ARGV[2] = window TTL in seconds.
// Returns [count, ttl_ms] — caller decides ok/remaining.
const RATE_LIMIT_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

let _redis: RedisLike | null = null;
let _redisFailedAt = 0;
const REDIS_RETRY_MS = 30_000;

async function getRedis(): Promise<RedisLike | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (_redisFailedAt && Date.now() - _redisFailedAt < REDIS_RETRY_MS) return null;
  if (_redis) return _redis;
  try {
    const { makeRedis } = await import("./make-redis");
    _redis = await makeRedis("ip-rate-limit", url, { maxRetriesPerRequest: 1 });
    _redisFailedAt = 0;
    return _redis;
  } catch {
    _redisFailedAt = Date.now();
    _redis = null;
    return null;
  }
}

/**
 * Check and consume one request slot for a given IP + endpoint key.
 *
 * @param ip         Client IP (from getClientIp)
 * @param key        Short identifier for the endpoint (e.g. "public:track-record")
 * @param limit      Maximum requests per window
 * @param windowSecs Window size in seconds (default 60)
 */
export async function checkIpRateLimit(
  ip: string,
  key: string,
  limit: number,
  windowSecs = 60,
): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / (windowSecs * 1000));
  const redisKey = `blackout:ratelimit:${key}:${ip}:${bucket}`;

  try {
    const client = await getRedis();
    if (!client) {
      return { ok: true, remaining: limit, resetAt: 0, limit };
    }

    const result = await client.eval(RATE_LIMIT_LUA, 1, redisKey, limit, windowSecs) as [number, number];
    const [count, ttlMs] = result;
    const ok = count <= limit;
    const remaining = Math.max(0, limit - count);
    const resetAt = ttlMs > 0 ? Date.now() + ttlMs : Date.now() + windowSecs * 1000;

    return { ok, remaining, resetAt, limit };
  } catch {
    // Redis error mid-session: arm retry backoff + clear cached client
    _redisFailedAt = Date.now();
    _redis = null;
    return { ok: true, remaining: limit, resetAt: 0, limit };
  }
}

/**
 * Build standard rate-limit response headers.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": result.resetAt > 0 ? String(Math.ceil(result.resetAt / 1000)) : "",
    ...(result.ok ? {} : { "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)) }),
  };
}
