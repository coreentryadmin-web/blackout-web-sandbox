// Redis-backed shared cache for Unusual Whales API responses.
// All UW calls for market-wide and per-ticker data go through here.
// TTLs are chosen so data is fresh enough for trading while staying under the 120/min UW plan cap.

// Redis client type matches the lazy-connect ioredis pattern used across this project
// (uw-rate-limiter.ts, shared-cache.ts, redis-pubsub.ts all use the same dynamic import approach).
type RedisClient = {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<"OK">;
  disconnect(): void;
};

// Cache TTLs in seconds — tuned per data type
export const UW_CACHE_TTL = {
  marketTide:        180,  // 3 min — market sentiment changes slowly
  sectorTide:        180,  // 3 min
  etfTide:           300,  // 5 min
  darkPoolTicker:    120,  // 2 min — dark pool prints intraday
  darkPoolRecent:    120,  // 2 min
  nope:              300,  // 5 min
  netPremTicks:       60,  // 1 min — most real-time irreplaceable signal
  flowPerStrike:     120,  // 2 min
  flowPerExpiry:     120,  // 2 min
  marketOiChange:    300,  // 5 min
  marketMovers:      300,  // 5 min
  topNetImpact:      300,  // 5 min
  congress:         1800,  // 30 min
  shortScreener:     600,  // 10 min
  ftds:             3600,  // 1 hr
  screenerStocks:    600,  // 10 min
  screenerContracts: 600,  // 10 min
  seasonality:      3600,  // 1 hr — historical, never changes intraday
  fdaCalendar:      1800,  // 30 min
  unusualTrades:     120,  // 2 min
  litFlow:           120,  // 2 min
} as const

const CACHE_PREFIX = 'uw_cache:'

// In-process in-flight dedup: collapses concurrent cold-miss fetches for the
// same key into a single fetcher() call (prevents a cold-start UW stampede that
// would blow the 120/min plan cap). Mirrors withServerCache's inflight Map in
// src/lib/server-cache.ts. Keyed by the logical cache key (not the Redis key) so
// it works identically whether or not Redis is configured.
const _inflight = new Map<string, Promise<unknown>>()

let _redis: RedisClient | null | undefined
let _redisInit: Promise<RedisClient | null> | null = null
const RETRY_BACKOFF_MS = 30_000
let _lastFailedAt = 0

async function getUwCacheRedis(): Promise<RedisClient | null> {
  const url = process.env.REDIS_URL?.trim()
  if (!url) return null
  if (_redis) return _redis
  if (_lastFailedAt && Date.now() - _lastFailedAt < RETRY_BACKOFF_MS) return null
  if (_redisInit) return _redisInit

  _redisInit = (async () => {
    try {
      const { makeRedis } = await import('../make-redis')
      const client = await makeRedis('uw-shared-cache', url, { maxRetriesPerRequest: 1 })
      _redis = client as unknown as RedisClient
      _lastFailedAt = 0
      return _redis
    } catch {
      _lastFailedAt = Date.now()
      _redisInit = null
      return null
    }
  })()

  return _redisInit
}

// Get or set a cached value. Calls fetcher() only on cache miss.
export async function uwCacheGet<T>(
  redis: RedisClient | null,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  if (redis) {
    try {
      const cached = await redis.get(CACHE_PREFIX + key)
      if (cached) return JSON.parse(cached) as T
    } catch { /* Redis miss — fall through to fetcher */ }
  }

  // Cold miss: dedup concurrent fetches for the same key. The first caller
  // creates the in-flight promise (which also performs the cache write);
  // concurrent callers await the same promise instead of stampeding upstream.
  const existing = _inflight.get(key) as Promise<T> | undefined
  if (existing) return existing

  const pending = (async (): Promise<T> => {
    const result = await fetcher()
    if (redis && result != null) {
      try {
        await redis.setex(CACHE_PREFIX + key, ttlSeconds, JSON.stringify(result))
      } catch { /* Cache write failure is non-fatal */ }
    }
    return result
  })().finally(() => {
    _inflight.delete(key)
  })

  _inflight.set(key, pending)
  return pending
}

/** Read Redis uw_cache without calling upstream — cross-replica WS snapshot lane. */
export async function uwCacheRead<T>(key: string): Promise<T | null> {
  const redis = await getUwCacheRedis()
  if (!redis) return null
  try {
    const cached = await redis.get(CACHE_PREFIX + key)
    if (!cached) return null
    return JSON.parse(cached) as T
  } catch {
    return null
  }
}

// Force-refresh a cache key (used by the cron refresher)
export async function uwCacheSet<T>(
  redis: RedisClient | null,
  key: string,
  ttlSeconds: number,
  value: T
): Promise<void> {
  if (!redis || value == null) return
  try {
    await redis.setex(CACHE_PREFIX + key, ttlSeconds, JSON.stringify(value))
  } catch { /* non-fatal */ }
}

// Resolve the shared Redis client for UW cache operations
export { getUwCacheRedis }

// Cache key builders
export const UW_KEYS = {
  marketTide:          ()                => 'market_tide',
  sectorTide:          (sector: string)  => `sector_tide:${sector}`,
  etfTide:             (etf: string)     => `etf_tide:${etf}`,
  // opts is part of the identity: callers use divergent {limit, min_premium}
  // shapes (uw-cache-refresh defaults, gex-heatmap limit:50, dark-pool route
  // limit:30, Vector's limit:30+min_premium:500k). A key that ignored opts let
  // whichever caller fetched first poison every other consumer for the TTL —
  // Vector's "institutional ≥$500k" filter was effectively dead for the
  // cron-warmed index tickers, while smaller tickers leaked Vector's filtered
  // view into the unfiltered heatmap/route reads.
  darkPoolTicker:      (ticker: string, opts?: { limit?: number; min_premium?: number }) =>
    `dark_pool:${ticker}:l${opts?.limit ?? 20}:p${opts?.min_premium ?? 0}`,
  darkPoolRecent:      ()                => 'dark_pool_recent',
  nope:                (ticker: string)  => `nope:${ticker}`,
  netPremTicks:        (ticker: string)  => `net_prem_ticks:${ticker}`,
  flowPerStrike:       (ticker: string)  => `flow_per_strike:${ticker}`,
  flowPerExpiry:       (ticker: string)  => `flow_per_expiry:${ticker}`,
  marketOiChange:      ()                => 'market_oi_change',
  marketMovers:        ()                => 'market_movers',
  topNetImpact:        ()                => 'top_net_impact',
  // Keyed by ticker (or 'all'): a per-ticker congress query and the market-wide
  // grid panel must never share a cache slot — first caller was winning the TTL
  // and cross-contaminating the other's rows.
  congress:            (ticker?: string) => `congress_recent_v2:${ticker ?? 'all'}`,
  shortScreener:       ()                => 'short_screener',
  ftds:                (ticker: string)  => `ftds:${ticker}`,
  screenerStocks:      ()                => 'screener_stocks',
  screenerContracts:   ()                => 'screener_contracts',
  seasonality:         (ticker: string)  => `seasonality:${ticker}`,
  fdaCalendar:         ()                => 'fda_calendar',
  unusualTrades:       ()                => 'unusual_trades',
  litFlow:             (ticker: string)  => `lit_flow:${ticker}`,
}
