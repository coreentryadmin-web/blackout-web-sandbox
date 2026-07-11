/** Preset Vector chart intervals — aggregated client-side from 1m SPX seed + live ticks. */
export const VECTOR_PRESET_TIMEFRAMES = [1, 3, 5, 15] as const;

/** @deprecated Use VECTOR_PRESET_TIMEFRAMES */
export const VECTOR_TIMEFRAMES = VECTOR_PRESET_TIMEFRAMES;

export type VectorPresetTimeframe = (typeof VECTOR_PRESET_TIMEFRAMES)[number];

/** Any whole-minute interval (presets + custom). */
export type VectorTimeframeMinutes = number;

export const VECTOR_INTERVAL_MIN = 1;
export const VECTOR_INTERVAL_MAX = 240;

export type VectorOhlcBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export function isPresetTimeframe(minutes: number): minutes is VectorPresetTimeframe {
  return (VECTOR_PRESET_TIMEFRAMES as readonly number[]).includes(minutes);
}

export function normalizeVectorIntervalMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 1;
  return Math.max(
    VECTOR_INTERVAL_MIN,
    Math.min(VECTOR_INTERVAL_MAX, Math.round(minutes))
  );
}

/** Bucket 1m bars into a higher interval (TradingView-style). Times are epoch seconds. */
export function aggregateVectorBars<T extends VectorOhlcBar>(
  bars: T[],
  intervalMinutes: number
): T[] {
  const interval = normalizeVectorIntervalMinutes(intervalMinutes);
  if (!bars.length || interval <= 1) return [...bars];
  const bucketSec = interval * 60;
  const map = new Map<number, T>();

  for (const bar of bars) {
    const key = Math.floor(bar.time / bucketSec) * bucketSec;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...bar, time: key } as T);
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      if (bar.volume != null && bar.volume > 0) {
        existing.volume = (existing.volume ?? 0) + bar.volume;
      }
    }
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

export function barsForVectorTimeframe<T extends VectorOhlcBar>(
  minuteBars: T[],
  intervalMinutes: number
): T[] {
  return aggregateVectorBars(minuteBars, intervalMinutes);
}

/**
 * Union two 1m bar arrays by time, sorted ascending. Fetched (Polygon closed)
 * bars are authoritative for OHLC — they replace live-built bars at the same
 * minute — but a live-built bar's volume survives when the fetched row has
 * none. Used by the SSE-reconnect backfill: bars that closed while the
 * connection was down (reconnect, replay window, tab sleep) are filled in
 * instead of remaining permanent session holes.
 */
export function mergeBarsByTime<T extends VectorOhlcBar & { volume?: number }>(
  existing: T[],
  fetched: T[]
): T[] {
  if (!fetched.length) return existing;
  const byTime = new Map<number, T>();
  for (const b of existing) byTime.set(b.time, b);
  for (const b of fetched) {
    const prev = byTime.get(b.time);
    byTime.set(
      b.time,
      prev && b.volume == null && prev.volume != null ? { ...b, volume: prev.volume } : b
    );
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
