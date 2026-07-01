/**
 * A legitimate published Night Hawk entry range is a tight intraday band. If
 * either side is non-positive, or the range width exceeds 20% of the average,
 * one side is almost certainly corrupt (e.g. a stray "17" against a stock
 * trading near $450) — treat the range as unusable rather than let a garbage
 * value skew a midpoint, a return %, or a track-record average.
 *
 * This guard originally lived only in track-record-page.ts's nhFromRows()
 * aggregate (the public/admin track-record page), so the exact same corrupt
 * rows still reached: the member-facing Night Hawk analytics route
 * (nighthawk/analytics.ts computed its own unguarded entry mid), and the
 * admin per-play audit table (PlayHistoryTable.tsx re-derived the midpoint
 * client-side from raw entry_range_low/high). Centralized here so every
 * consumer of a published entry range applies the same corruption check.
 */
export const MAX_ENTRY_RANGE_WIDTH_PCT = 0.2;

export function entryRangeMid(low: number | null | undefined, high: number | null | undefined): number | null {
  if (low == null || high == null) return null;
  if (low <= 0 || high <= 0) return null;
  const avg = (low + high) / 2;
  const width = Math.abs(high - low);
  if (width > avg * MAX_ENTRY_RANGE_WIDTH_PCT) return null;
  return avg;
}
