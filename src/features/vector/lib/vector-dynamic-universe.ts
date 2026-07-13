import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { normalizeVectorTicker, isVectorTickerAllowed } from "./vector-ticker";

/**
 * DYNAMIC UNIVERSE — "open it once and Vector keeps recording it" (user-directed, 2026-07-13).
 *
 * The static ~22-name universe is the only set the 5-min recorder cron covered, so any other
 * ticker's rail existed only while someone was actively viewing it — the next morning it started
 * from scratch ("first thing I see is one bead"). This module makes every VIEWED ticker part of
 * the recorded universe automatically:
 *
 *  - `touchDynamicUniverse(ticker)` fires on every Vector stream attach (a member actually opened
 *    the chart) — debounced per process, fire-and-forget, never throws into the hot path.
 *  - The recorder cron unions `listDynamicUniverseTickers()` into its ticker set, so a name viewed
 *    today is recorded from TOMORROW'S OPENING BELL onward, viewer or not.
 *  - Retention: names not viewed for RETENTION_DAYS drop out (a one-time curiosity must not tax
 *    the cron forever — reopening re-adds instantly). Capacity: newest CAP names by last-view
 *    (recording is Polygon-cache work per ticker per 5 min; the cap bounds cron runtime).
 *
 * Storage is one shared-Redis map (ticker → lastViewedMs) so all replicas and the cron task see
 * the same set. Concurrent touches do read-modify-write and can lose a race — acceptable: the
 * loser's ticker is re-added on its next touch, and nothing here is a source of truth for money.
 */
const KEY = "vector:universe:dynamic";
/** Redis TTL — comfortably beyond retention so the map never silently vanishes mid-window. */
const KEY_TTL_SEC = 45 * 24 * 3600;
export const DYNAMIC_UNIVERSE_RETENTION_DAYS = 14;
// 100, not 30 (user-directed): many members will be opening names. Recording is Polygon-cache
// work per ticker per 5 min; at 100 the cron still fits its window because fetchGexHeatmap is
// Redis-cache-first (warm names are near-free). Chunked cron processing is queued as hardening.
export const DYNAMIC_UNIVERSE_CAP = 100;
/** Per-process debounce: a hot ticker with many viewers touches Redis at most once per window. */
const TOUCH_DEBOUNCE_MS = 10 * 60 * 1000;

type DynamicMap = Record<string, number>;

const lastTouch = new Map<string, number>();

/** Static-universe membership (uppercased) — static names never need dynamic tracking. */
function isStatic(ticker: string): boolean {
  return vectorUniverseTickers().includes(ticker);
}

/**
 * Prune helper (pure, tested): drop entries older than retention, then keep the newest `cap`
 * by last-view. Exported for tests.
 */
export function pruneDynamicUniverse(
  map: DynamicMap,
  nowMs: number,
  opts: { retentionMs?: number; cap?: number } = {}
): DynamicMap {
  const retentionMs = opts.retentionMs ?? DYNAMIC_UNIVERSE_RETENTION_DAYS * 24 * 3600 * 1000;
  const cap = opts.cap ?? DYNAMIC_UNIVERSE_CAP;
  const fresh = Object.entries(map).filter(
    ([t, at]) => typeof at === "number" && Number.isFinite(at) && nowMs - at <= retentionMs && t
  );
  fresh.sort((a, b) => b[1] - a[1]); // newest first
  return Object.fromEntries(fresh.slice(0, cap));
}

/** Record that a member opened `ticker` on Vector. Fire-and-forget; never throws. */
export async function touchDynamicUniverse(rawTicker: string): Promise<void> {
  try {
    if (!isVectorTickerAllowed(rawTicker)) return;
    const ticker = normalizeVectorTicker(rawTicker);
    if (!ticker || isStatic(ticker)) return;
    const now = Date.now();
    const prev = lastTouch.get(ticker);
    if (prev != null && now - prev < TOUCH_DEBOUNCE_MS) return;
    lastTouch.set(ticker, now);
    const map = (await sharedCacheGet<DynamicMap>(KEY)) ?? {};
    map[ticker] = now;
    await sharedCacheSet(KEY, pruneDynamicUniverse(map, now), KEY_TTL_SEC);
  } catch {
    /* best-effort: universe tracking must never disturb the live stream */
  }
}

/** The dynamic names the recorder cron should union into its ticker set. Never throws. */
export async function listDynamicUniverseTickers(): Promise<string[]> {
  try {
    const map = (await sharedCacheGet<DynamicMap>(KEY)) ?? {};
    return Object.keys(pruneDynamicUniverse(map, Date.now()));
  } catch {
    return [];
  }
}
