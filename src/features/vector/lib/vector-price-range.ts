/**
 * Price-range extension so the chart's visible band includes the dealer walls,
 * not just the intraday candles.
 *
 * The bug this fixes: lightweight-charts autoscales the price axis to the candle
 * series only. Wall price-lines and bead markers never widen the range, so any
 * wall outside the intraday candle band renders OFF-SCREEN. In a long-gamma
 * session the put (support) walls often sit a few % below spot — well below the
 * tight candle band — so the member saw only the yellow call rails and NO purple
 * put beads, even though the put walls were computed and drawn (just clipped).
 *
 * Fix: union the candle-derived range with any wall strikes within ±maxPct of
 * spot. Only extends when a wall is actually outside the candle band (walls
 * already in view cost nothing), and the ±maxPct cap keeps a very far, weak wall
 * from squishing the candles into a sliver. Pure + testable; the chart calls it
 * from the candle series' autoscaleInfoProvider.
 */

export type PriceRange = { minValue: number; maxValue: number };

/** Default: reveal walls up to 5% from spot. Beyond that a wall is too far to be
 *  worth collapsing the candle detail for. Env-tunable via the chart. */
export const DEFAULT_WALL_VIEW_MAX_PCT = 0.05;

export function extendRangeForWalls(
  base: PriceRange,
  spot: number | null | undefined,
  callStrikes: readonly number[],
  putStrikes: readonly number[],
  maxPct: number = DEFAULT_WALL_VIEW_MAX_PCT
): PriceRange {
  let { minValue, maxValue } = base;
  if (!(typeof spot === "number" && spot > 0) || !(maxPct > 0)) return { minValue, maxValue };

  const floor = spot * (1 - maxPct);
  const ceil = spot * (1 + maxPct);

  // Call walls sit above spot (resistance) → they can push the TOP of the range up.
  for (const s of callStrikes) {
    if (Number.isFinite(s) && s > 0 && s <= ceil && s > maxValue) maxValue = s;
  }
  // Put walls sit below spot (support) → they can push the BOTTOM of the range down.
  for (const s of putStrikes) {
    if (Number.isFinite(s) && s > 0 && s >= floor && s < minValue) minValue = s;
  }

  // Small pad on any side we extended, so a revealed bead isn't flush to the frame edge.
  const span = maxValue - minValue;
  if (span > 0) {
    const pad = span * 0.02;
    if (maxValue > base.maxValue) maxValue += pad;
    if (minValue < base.minValue) minValue -= pad;
  }
  return { minValue, maxValue };
}
