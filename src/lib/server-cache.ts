type CacheEntry<T> = { value: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();

/** In-process TTL cache — dedupes vendor calls across concurrent dashboard users. */
export async function withServerCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  if (ttlMs <= 0) return loader();

  const now = Date.now();
  const hit = store.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await loader();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}
