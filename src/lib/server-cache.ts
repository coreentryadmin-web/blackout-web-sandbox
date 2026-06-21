type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  /** Wall-clock time the entry was last successfully refreshed. */
  refreshedAt: number;
};

/** Tracks consecutive revalidation failures per cache key. */
const failureCount = new Map<string, number>();
/** Keys whose upstream is considered degraded (>= FAILURE_THRESHOLD failures). */
const degradedKeys = new Set<string>();

/** Number of consecutive revalidation failures before marking a key degraded. */
const FAILURE_THRESHOLD = 3;
/**
 * Maximum age (ms) of a stale entry that will still be served during SWR.
 * After this window, null / a fresh fetch is forced instead of returning
 * perpetually stale data.
 */
const MAX_STALE_AGE_MS = 10 * 60 * 1000; // 10 minutes

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

type CacheOpts = {
  staleWhileRevalidate?: boolean;
  /** If true, callers can detect upstream degradation via isDegraded(). */
  trackDegradation?: boolean;
};

/**
 * Returns true if the upstream for `key` has exceeded FAILURE_THRESHOLD
 * consecutive revalidation failures.  Callers can use this to surface a
 * warning UI or skip non-critical enrichment.
 */
export function isDegraded(key: string): boolean {
  return degradedKeys.has(key);
}

async function readRedisCache<T>(key: string): Promise<{ value: T; remainingTtlSec: number } | null> {
  if (!process.env.REDIS_URL?.trim()) return null;
  try {
    const { sharedCacheGetWithTtl } = await import("@/lib/shared-cache");
    return sharedCacheGetWithTtl<T>(`server:${key}`);
  } catch {
    return null;
  }
}

async function writeRedisCache<T>(key: string, value: T, ttlMs: number): Promise<void> {
  if (!process.env.REDIS_URL?.trim() || ttlMs <= 0) return;
  try {
    const { sharedCacheSet } = await import("@/lib/shared-cache");
    await sharedCacheSet(`server:${key}`, value, Math.max(1, Math.round(ttlMs / 1000)));
  } catch {
    // ignore redis write failures
  }
}

/** In-process TTL cache with in-flight dedup + optional stale-while-revalidate + Redis layer. */
export async function withServerCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  opts: CacheOpts = {}
): Promise<T> {
  const swr = opts.staleWhileRevalidate !== false;
  if (ttlMs <= 0) return loader();

  const now = Date.now();
  const hit = store.get(key) as CacheEntry<T> | undefined;

  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  if (!hit) {
    const redisHit = await readRedisCache<T>(key);
    if (redisHit != null) {
      // Use the remaining TTL from Redis, not the full configured TTL, so the
      // in-memory entry expires in sync with the Redis key.
      const remainingMs = redisHit.remainingTtlSec * 1000;
      store.set(key, { value: redisHit.value, expiresAt: now + remainingMs, refreshedAt: now });
      return redisHit.value;
    }
  }

  // Fast lanes: always await a fresh build once TTL expires (no stale handoff).
  if (hit && hit.expiresAt <= now && !swr) {
    if (inflight.has(key)) return inflight.get(key) as Promise<T>;
    return refreshCache(key, ttlMs, loader);
  }

  // Cache expired but we have data — return stale immediately, refresh in background.
  // FIX 5a: Enforce a maximum stale age. If the entry is older than MAX_STALE_AGE_MS
  // since its last successful refresh, do not serve it; fall through to a blocking
  // fetch so callers are never permanently stuck on stale data.
  if (hit && hit.expiresAt <= now && !inflight.has(key)) {
    const staleAge = now - hit.refreshedAt;
    if (staleAge > MAX_STALE_AGE_MS) {
      // Entry is too old — do a blocking refresh (or throw if upstream is down).
      return refreshCache(key, ttlMs, loader);
    }
    void refreshCache(key, ttlMs, loader);
    return hit.value;
  }

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  return refreshCache(key, ttlMs, loader);
}

// ---------------------------------------------------------------------------
// Standard TTLs — shared constants so route files and run-tool.ts use the
// same durations without magic numbers scattered across the codebase.
// ---------------------------------------------------------------------------
export const TTL = {
  MARKET_SNAPSHOT: 5_000,       // 5 seconds — live price data
  OPTIONS_CHAIN:   30_000,      // 30 seconds
  NEWS:            120_000,     // 2 minutes
  ANALYST:         300_000,     // 5 minutes
  EARNINGS:        300_000,     // 5 minutes
  REFERENCE:       3_600_000,   // 1 hour
  TICKER_SEARCH:   300_000,     // 5 minutes
  IPO_CALENDAR:    3_600_000,   // 1 hour
  DARK_POOL:       30_000,      // 30 seconds
  MARKET_TIDE:     60_000,      // 1 minute
} as const;

/**
 * Convenience alias for withServerCache — matches the simpler signature used
 * in route files that don't need stale-while-revalidate control.
 * 500 concurrent users share ONE upstream call per TTL window.
 */
export async function serverCache<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  return withServerCache(key, ttlMs, fn);
}

async function refreshCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const promise = loader()
    .then((value) => {
      const refreshedAt = Date.now();
      store.set(key, { value, expiresAt: refreshedAt + ttlMs, refreshedAt });
      void writeRedisCache(key, value, ttlMs);
      // FIX 5b: Successful refresh — reset failure tracking for this key.
      failureCount.delete(key);
      degradedKeys.delete(key);
      return value;
    })
    .catch((err: unknown) => {
      // FIX 5b: Track consecutive failures and flag key as degraded after threshold.
      const failures = (failureCount.get(key) ?? 0) + 1;
      failureCount.set(key, failures);
      if (failures >= FAILURE_THRESHOLD) {
        degradedKeys.add(key);
        console.error(
          `[server-cache] CRITICAL: upstream for cache key "${key}" has failed ` +
            `${failures} consecutive time(s). Serving stale data where available. ` +
            `Error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
