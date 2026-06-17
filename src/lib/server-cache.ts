type CacheEntry<T> = { value: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

type CacheOpts = { staleWhileRevalidate?: boolean };

async function readRedisCache<T>(key: string): Promise<T | null> {
  if (!process.env.REDIS_URL?.trim()) return null;
  try {
    const { sharedCacheGet } = await import("@/lib/shared-cache");
    return sharedCacheGet<T>(`server:${key}`);
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
      store.set(key, { value: redisHit, expiresAt: now + ttlMs });
      return redisHit;
    }
  }

  // Fast lanes: always await a fresh build once TTL expires (no stale handoff).
  if (hit && hit.expiresAt <= now && !swr) {
    if (inflight.has(key)) return inflight.get(key) as Promise<T>;
    return refreshCache(key, ttlMs, loader);
  }

  // Cache expired but we have data — return stale immediately, refresh in background.
  if (hit && hit.expiresAt <= now && !inflight.has(key)) {
    void refreshCache(key, ttlMs, loader);
    return hit.value;
  }

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  return refreshCache(key, ttlMs, loader);
}

async function refreshCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const promise = loader()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      void writeRedisCache(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
