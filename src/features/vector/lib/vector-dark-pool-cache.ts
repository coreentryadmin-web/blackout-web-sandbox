import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { fetchUwDarkPool } from "@/lib/providers/unusual-whales";
import { isHeatmapOverlayAllowed } from "@/lib/heatmap-allowlist";
import {
  darkPoolLevelsFromSnapshot,
  type VectorDarkPoolLevel,
} from "./vector-dark-pool-levels";
import { isVectorIndexTicker, normalizeVectorTicker } from "./vector-ticker";

const KEY_PREFIX = "vector:dark-pool";
const TTL_SEC = 90;

function redisKey(ticker: string): string {
  return `${KEY_PREFIX}:${normalizeVectorTicker(ticker)}`;
}

/** Cache-reader — dark pool levels for Vector (written by vector-dark-pool-warm cron). */
export async function getCachedVectorDarkPool(ticker: string): Promise<VectorDarkPoolLevel[]> {
  const t = normalizeVectorTicker(ticker);
  if (!isHeatmapOverlayAllowed(t)) return [];
  const hit = await sharedCacheGet<VectorDarkPoolLevel[]>(redisKey(t));
  return hit ?? [];
}

export async function setCachedVectorDarkPool(
  ticker: string,
  levels: VectorDarkPoolLevel[]
): Promise<void> {
  const t = normalizeVectorTicker(ticker);
  await sharedCacheSet(redisKey(t), levels, TTL_SEC);
}

/** Cron writer — fetch UW dark pool once per ticker and persist to Redis. */
export async function warmVectorDarkPool(ticker: string): Promise<number> {
  const t = normalizeVectorTicker(ticker);
  if (!isHeatmapOverlayAllowed(t)) return 0;

  const scale = isVectorIndexTicker(t) && t !== "SPY" ? "spx-from-spy" : "native";
  const primary = t === "SPX" ? "SPX" : t;
  const fallback = t === "SPX" ? "SPY" : null;

  const spx = await fetchUwDarkPool(primary, { limit: 30, min_premium: 500_000 }).catch(() => null);
  let levels = darkPoolLevelsFromSnapshot(spx, { scale });
  if (!levels.length && fallback) {
    const fb = await fetchUwDarkPool(fallback, { limit: 30, min_premium: 500_000 }).catch(() => null);
    levels = darkPoolLevelsFromSnapshot(fb, { scale: t === "SPX" ? "spx-from-spy" : "native" });
  }

  await setCachedVectorDarkPool(t, levels);
  return levels.length;
}
