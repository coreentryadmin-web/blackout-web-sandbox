type CacheEntry<T> = { value: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

type CacheOpts = { staleWhileRevalidate?: boolean };

/** In-process TTL cache with in-flight dedup + optional stale-while-revalidate. */
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
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
