import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

/** ISSUE-23: Cache entry with timestamp for TTL enforcement. */
type BundleEntry = {
  bundle: Awaited<ReturnType<typeof loadMergedSpxDesk>>;
  cachedAt: number;
};

const CACHE_TTL_MS = 60_000; // 60 seconds
const MAX_CACHE_SIZE = 100;

/** Per-user cache keyed by userId — prevents one user's request from overwriting another's. */
const bundleByUser = new Map<string, BundleEntry>();

export function resetLargoSpxDeskCache(userId: string): void {
  bundleByUser.delete(userId);
}

/** One merged desk load per Largo query per user — pulse + flow + full desk, same as SPX Sniper. */
export async function getLargoSpxLiveDesk(userId: string): Promise<SpxDeskPayload> {
  const now = Date.now();
  const existing = bundleByUser.get(userId) ?? null;

  // ISSUE-23: Enforce 60s TTL — a hit older than that is stale and must be reloaded.
  if (existing && now - existing.cachedAt <= CACHE_TTL_MS) {
    return existing.bundle.merged;
  }

  // Evict stale or missing entry before fetching.
  if (existing) bundleByUser.delete(userId);

  // ISSUE-23: Evict LRU entries when the cache exceeds max size to prevent memory leak.
  if (bundleByUser.size >= MAX_CACHE_SIZE) {
    const oldestKey = bundleByUser.keys().next().value;
    if (oldestKey !== undefined) bundleByUser.delete(oldestKey);
  }

  const bundle = await loadMergedSpxDesk();
  bundleByUser.set(userId, { bundle, cachedAt: now });
  return bundle.merged;
}
