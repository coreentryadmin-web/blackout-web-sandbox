/**
 * Deliberately dependency-free (no server-only imports) — VectorChart.tsx ("use client")
 * imports this directly. It used to live in vector-spy-volume.ts alongside the
 * Polygon-fetching functions, which pulled that whole server-only module graph
 * (polygon.ts → polygon-rate-limiter.ts → api-tracked-fetch.ts → api-telemetry.ts →
 * api-telemetry-persist.ts, which imports "server-only") into the client bundle and broke
 * the build. Keep this file's imports at zero.
 */

/**
 * Merge fetched SPY volume rows onto SPX bars by matching minute bucket. Only ever fills
 * in a bar's volume — never clobbers an already-set one with a different value — so it's
 * safe to call repeatedly with a growing/refreshed row set (VectorChart.tsx polls
 * /api/market/vector/spy-volume on an interval rather than once, since Polygon only ever
 * returns CLOSED minute bars: a mount-only merge permanently misses every bar that closes
 * after that one call).
 */
export function mergeSpyVolumeRows<T extends { time: number; volume?: number }>(
  bars: T[],
  rows: Array<{ time: number; volume: number }>
): T[] {
  if (!rows.length) return bars;
  const map = new Map(rows.map((r) => [r.time, r.volume]));
  let touched = false;
  const merged = bars.map((b) => {
    const vol = map.get(b.time);
    if (vol == null || vol <= 0) return b;
    touched = true;
    return { ...b, volume: vol };
  });
  return touched ? merged : bars;
}
