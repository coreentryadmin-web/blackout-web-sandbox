/** Standard Vector chart intervals — aggregated client-side from 1m SPX seed + live ticks. */
export const VECTOR_TIMEFRAMES = [1, 3, 5, 15] as const;

export type VectorTimeframeMinutes = (typeof VECTOR_TIMEFRAMES)[number];

export type VectorOhlcBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** Bucket 1m bars into a higher interval (TradingView-style). Times are epoch seconds. */
export function aggregateVectorBars<T extends VectorOhlcBar>(
  bars: T[],
  intervalMinutes: VectorTimeframeMinutes
): T[] {
  if (!bars.length || intervalMinutes <= 1) return [...bars];
  const bucketSec = intervalMinutes * 60;
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
    }
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

export function barsForVectorTimeframe<T extends VectorOhlcBar>(
  minuteBars: T[],
  intervalMinutes: VectorTimeframeMinutes
): T[] {
  return aggregateVectorBars(minuteBars, intervalMinutes);
}
