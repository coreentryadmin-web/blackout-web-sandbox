import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { fetchUwDarkPool } from "@/lib/providers/unusual-whales";
import { isHeatmapOverlayAllowed } from "@/lib/heatmap-allowlist";
import {
  darkPoolLevelsFromSnapshot,
  type VectorDarkPoolLevel,
} from "./vector-dark-pool-levels";
import { isVectorIndexTicker, normalizeVectorTicker } from "./vector-ticker";

const KEY_PREFIX = "vector:dark-pool";
/**
 * Must comfortably outlive the warm cron's cadence (every 10 min) or the
 * levels blink out between runs: the old 90s TTL left the overlay EMPTY for
 * ~8.5 of every 10 minutes of RTH — absence rendering as "no dark-pool
 * activity". 25 min = 2.5× the cadence, tolerating one missed run. Staleness
 * is disclosed via fetchedAt rather than hidden via expiry.
 */
const TTL_SEC = 25 * 60;

type DarkPoolCacheEntry = {
  levels: VectorDarkPoolLevel[];
  /** When the underlying UW fetch actually succeeded — NOT when it was served. */
  fetchedAt: number;
};

export type VectorDarkPoolRead = DarkPoolCacheEntry;

function redisKey(ticker: string): string {
  return `${KEY_PREFIX}:${normalizeVectorTicker(ticker)}`;
}

function normalizeEntry(hit: unknown): DarkPoolCacheEntry | null {
  if (Array.isArray(hit)) {
    // Pre-envelope cache shape (bare array) — age unknown; report epoch so
    // consumers see "not fresh" instead of assuming it is.
    return { levels: hit as VectorDarkPoolLevel[], fetchedAt: 0 };
  }
  if (hit && typeof hit === "object" && Array.isArray((hit as DarkPoolCacheEntry).levels)) {
    const e = hit as DarkPoolCacheEntry;
    return { levels: e.levels, fetchedAt: Number.isFinite(e.fetchedAt) ? e.fetchedAt : 0 };
  }
  return null;
}

/** Cache-reader — dark pool levels for Vector (written by vector-dark-pool-warm cron). */
export async function getCachedVectorDarkPool(ticker: string): Promise<VectorDarkPoolLevel[]> {
  return (await getCachedVectorDarkPoolWithAge(ticker)).levels;
}

/** Levels plus the fetch timestamp, so payloads can disclose staleness. */
export async function getCachedVectorDarkPoolWithAge(ticker: string): Promise<VectorDarkPoolRead> {
  const t = normalizeVectorTicker(ticker);
  if (!isHeatmapOverlayAllowed(t)) return { levels: [], fetchedAt: 0 };
  const hit = await sharedCacheGet<unknown>(redisKey(t));
  return normalizeEntry(hit) ?? { levels: [], fetchedAt: 0 };
}

export async function setCachedVectorDarkPool(
  ticker: string,
  levels: VectorDarkPoolLevel[],
  fetchedAt: number = Date.now()
): Promise<void> {
  const t = normalizeVectorTicker(ticker);
  const entry: DarkPoolCacheEntry = { levels, fetchedAt };
  await sharedCacheSet(redisKey(t), entry, TTL_SEC);
}

export type WarmVectorDarkPoolResult = {
  levels: number;
  /** True when every underlying UW fetch failed — distinct from "fetched fine, zero prints". */
  fetchFailed: boolean;
};

/** Cron writer — fetch UW dark pool once per ticker and persist to Redis. */
export async function warmVectorDarkPool(ticker: string): Promise<WarmVectorDarkPoolResult> {
  const t = normalizeVectorTicker(ticker);
  if (!isHeatmapOverlayAllowed(t)) return { levels: 0, fetchFailed: false };

  const scale = isVectorIndexTicker(t) && t !== "SPY" ? "spx-from-spy" : "native";
  const primary = t === "SPX" ? "SPX" : t;
  const fallback = t === "SPX" ? "SPY" : null;

  const spx = await fetchUwDarkPool(primary, { limit: 30, min_premium: 500_000 }).catch(() => null);
  let fetchFailed = spx == null;
  let levels = darkPoolLevelsFromSnapshot(spx, { scale });
  if (!levels.length && fallback) {
    const fb = await fetchUwDarkPool(fallback, { limit: 30, min_premium: 500_000 }).catch(() => null);
    fetchFailed = fetchFailed && fb == null;
    levels = darkPoolLevelsFromSnapshot(fb, { scale: t === "SPX" ? "spx-from-spy" : "native" });
  }

  // A transient UW outage must not actively WIPE good levels a previous run
  // fetched — skip the write so the previous entry survives under its own TTL
  // with its honest (older) fetchedAt. A successful fetch always writes,
  // including a genuinely-empty result (zero qualifying prints is real data).
  if (!fetchFailed) {
    await setCachedVectorDarkPool(t, levels);
  }
  return { levels: levels.length, fetchFailed };
}
