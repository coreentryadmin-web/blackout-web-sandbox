/**
 * Per-IP fixed-window rate limiter backed by Redis.
 *
 * Fails open: if Redis is unavailable, requests still get through rather than
 * blocking a paying user on a Redis blip — that bias is correct for a trading
 * platform and must not change. What "fails open" must NOT mean is "rate
 * limiting is off": see the in-memory fallback below (`checkInMemoryFallback`),
 * which enforces the SAME limit/window per-process whenever Redis can't be
 * reached, instead of unconditionally returning `{ ok: true }` (docs/audit/
 * FINDINGS.md, task #177 — a probe sent 30 rapid POSTs to a 20/min endpoint
 * during a Redis-unavailable window and got zero 429s).
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
 * Cloudflare sets CF-Connecting-IP; ALB/generic proxies use x-forwarded-for.
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

// ── In-memory fallback (Redis-unavailable backstop) ──────────────────────────
//
// Used ONLY on the two paths that used to return an unconditional `{ ok: true }`:
// `getRedis()` resolving to `null` (no REDIS_URL, or inside the REDIS_RETRY_MS
// backoff after a recent failure) and the `client.eval(...)` call throwing.
// The Redis-backed happy path above never touches this.
//
// Deliberate trade-off — PER PROCESS, not cluster-wide: ECS runs multiple
// replicas, and this Map lives in one replica's memory, not a shared store. So
// during a real Redis outage, a client that gets load-balanced across R replicas
// can get up to R * limit requests per window, not a true cluster-wide `limit`.
// That's strictly weaker than the Redis-backed limit — it's a coarse per-replica
// facsimile, not a full backstop — but it's vastly better than the zero limit
// (unconditional `ok: true`) it replaces, and it self-heals the instant Redis
// comes back (the `try` block above resumes being the source of truth).
type FallbackEntry = { count: number; resetAt: number };
const _fallbackCounters = new Map<string, FallbackEntry>();

// Hard cap on tracked keys, to bound memory under sustained abuse from many
// distinct IPs/keys during a real outage (the exact scenario this fallback
// exists for). Every entry here is a short-lived fixed-window counter — it's
// only ever relevant for at most `windowSecs` (typically 60s) — so if the map
// ever balloons past this cap, the simplest safe move is to sweep out expired
// entries first, and if that alone doesn't bring it back under the cap (i.e.
// there are genuinely this many concurrent distinct keys in-flight at once),
// drop everything. Worst case that causes a handful of counters to reset early
// — a brief, self-healing blip back toward fail-open for those specific keys —
// which is an acceptable cost for a backstop that only needs to be "a real
// limit," not a perfect one. A size cap + occasional full clear is simpler and
// cheaper than an LRU/TTL-heap for what is otherwise a non-issue in steady state
// (the map normally stays tiny, since keys churn out every window).
const FALLBACK_MAX_ENTRIES = 5_000;

function checkInMemoryFallback(
  redisKey: string,
  bucket: number,
  limit: number,
  windowSecs: number,
): RateLimitResult {
  const now = Date.now();
  // resetAt is derived from the bucket boundary (same fixed-window scheme the
  // Redis path uses), not from `now` + windowSecs — so it's exact regardless of
  // when within the window this particular call lands.
  const resetAt = (bucket + 1) * windowSecs * 1000;

  if (_fallbackCounters.size > FALLBACK_MAX_ENTRIES) {
    for (const [k, entry] of _fallbackCounters) {
      if (entry.resetAt <= now) _fallbackCounters.delete(k);
    }
    if (_fallbackCounters.size > FALLBACK_MAX_ENTRIES) {
      _fallbackCounters.clear();
    }
  }

  const existing = _fallbackCounters.get(redisKey);
  // A stale entry (resetAt already passed) is treated as absent — belt-and-
  // suspenders alongside the bucket already being baked into `redisKey`, in
  // case a caller ever reuses a key across differing windowSecs values.
  const count = existing && existing.resetAt > now ? existing.count + 1 : 1;
  _fallbackCounters.set(redisKey, { count, resetAt });

  return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt, limit };
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
      return checkInMemoryFallback(redisKey, bucket, limit, windowSecs);
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
    return checkInMemoryFallback(redisKey, bucket, limit, windowSecs);
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
