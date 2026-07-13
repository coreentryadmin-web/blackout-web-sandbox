/**
 * Price-axis autoscale guard for the Vector chart.
 *
 * The chart re-triggers the price-axis autoscale after drawing walls/beads (refreshTrails +
 * refreshOverlays) so newly formed structure reveals without waiting for a candle update. Those
 * paths run on EVERY SSE tick (~1/sec in RTH). Unconditionally re-forcing `autoScale: true` on
 * every tick is what produced the member-reported "I zoom in and a split second later it zooms
 * out" bug: lightweight-charts flips the price scale's `autoScale` option to false the instant the
 * member drags/zooms the vertical axis (PriceScaleApi.setAutoScale → applyOptions({autoScale:false})),
 * and the next tick snapped it straight back to the wide walls-spanning autoscale band.
 *
 * The #299 fix preserved the TIME axis (visible logical range), which is why the horizontal zoom
 * stuck but the vertical one still reverted — the price axis was the surviving unguarded reset.
 *
 * This guard re-asserts autoscale ONLY when it is still engaged (member hasn't taken manual
 * control). Reading `options().autoScale` is reliable in lightweight-charts v5 because the manual
 * drag handler routes through applyOptions, so the option mirrors the member's control state.
 * Double-clicking the price axis re-enables autoScale (lib default), so members keep a path back to
 * auto-fit.
 */
export interface PriceScaleLike {
  options(): { autoScale?: boolean };
  applyOptions(options: { autoScale: boolean }): void;
}

/**
 * Re-assert price-axis autoscale iff it is currently engaged.
 * @returns true when the autoscale nudge was applied; false when a manual member zoom was respected.
 */
export function reassertPriceAutoScale(priceScale: PriceScaleLike): boolean {
  if (priceScale.options().autoScale) {
    priceScale.applyOptions({ autoScale: true });
    return true;
  }
  return false;
}
