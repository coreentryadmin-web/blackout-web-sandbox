import { readSessionCache, writeSessionCache } from "@/lib/session-cache";

const MATRIX_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

function cacheKey(ticker: string): string {
  return `gex-heatmap:${ticker.trim().toUpperCase() || "SPX"}`;
}

/** Last matrix snapshot for stale-while-revalidate instant paint on navigation. */
export function readGexHeatmapSessionCache<T>(ticker: string): T | undefined {
  return readSessionCache<T>(cacheKey(ticker), MATRIX_CACHE_MAX_AGE_MS);
}

export function writeGexHeatmapSessionCache<T>(ticker: string, payload: T): void {
  writeSessionCache(cacheKey(ticker), payload);
}
