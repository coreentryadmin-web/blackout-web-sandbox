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

/** Default: densely reveal EVERY wall up to 5% from spot. Beyond that we still reveal the single
 *  NEAREST wall on each side (see below) but stop pulling in the whole cluster. Env-tunable. */
export const DEFAULT_WALL_VIEW_MAX_PCT = 0.05;

/** Hard cap for the "always reveal the nearest wall each side" guarantee. In a long-gamma session
 *  the closest put (support) wall can sit 6-10% below spot — just past the 5% dense window — which
 *  is exactly why members saw only the yellow call rails and NO purple put beads (the put wall was
 *  computed and drawn, just clipped off the bottom). We always pull the nearest call AND nearest
 *  put into view up to this cap so BOTH colors show whenever real walls exist, without letting a
 *  pathologically far wall squish the candles into a sliver. */
export const NEAREST_WALL_VIEW_MAX_PCT = 0.12;

/** Reveal cap for the ACTUALLY-DRAWN bead rows (the session-trail strikes the chart renders as
 *  beads), independent of the current-ladder wall caps above. The bug it fixes: the axis widened
 *  only for the LIVE ladder's top-N strikes, but beads are drawn from the whole-session trail —
 *  so a bead at a strike not in the current ladder was clipped, and because zoom re-runs autoscale
 *  off the now-fewer visible candles, those beads would VANISH on zoom-in and reappear on zoom-out.
 *  Feeding the drawn-bead strikes through this wider cap keeps every drawn bead in view at every
 *  zoom level (the Skylit "wide rail" look), while still bounding a pathological outlier so it
 *  can't squash the candles to a sliver. Wider than the ladder caps because the drawn set is
 *  already curated (top-N by strength per side), so revealing all of it is intended, not noise. */
export const BEAD_VIEW_MAX_PCT = 0.2;

export function extendRangeForWalls(
  base: PriceRange,
  spot: number | null | undefined,
  callStrikes: readonly number[],
  putStrikes: readonly number[],
  maxPct: number = DEFAULT_WALL_VIEW_MAX_PCT,
  nearestMaxPct: number = NEAREST_WALL_VIEW_MAX_PCT
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

  // ALWAYS reveal the nearest wall on each side, even a bit past the dense window (up to the hard
  // cap), so both call (gold) and put (purple) beads are visible whenever the walls exist — the
  // fix for "I only see yellow beads." Nearest = closest strike to spot on that side.
  const hardCeil = spot * (1 + nearestMaxPct);
  const hardFloor = spot * (1 - nearestMaxPct);
  let nearestCall = Infinity;
  for (const s of callStrikes) {
    if (Number.isFinite(s) && s > spot && s <= hardCeil && s < nearestCall) nearestCall = s;
  }
  if (Number.isFinite(nearestCall) && nearestCall > maxValue) maxValue = nearestCall;
  let nearestPut = 0;
  for (const s of putStrikes) {
    if (Number.isFinite(s) && s > 0 && s < spot && s >= hardFloor && s > nearestPut) nearestPut = s;
  }
  if (nearestPut > 0 && nearestPut < minValue) minValue = nearestPut;

  // Small pad on any side we extended, so a revealed bead isn't flush to the frame edge.
  const span = maxValue - minValue;
  if (span > 0) {
    const pad = span * 0.02;
    if (maxValue > base.maxValue) maxValue += pad;
    if (minValue < base.minValue) minValue -= pad;
  }
  return { minValue, maxValue };
}
