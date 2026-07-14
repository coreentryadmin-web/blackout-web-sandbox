import { test } from "node:test";
import assert from "node:assert/strict";
import { reassertPriceAutoScale, type PriceScaleLike } from "./vector-price-autoscale";

/** Minimal price-scale double that records applyOptions calls and reflects the option back. */
function fakePriceScale(autoScale: boolean): PriceScaleLike & { applied: Array<{ autoScale: boolean }> } {
  const applied: Array<{ autoScale: boolean }> = [];
  return {
    applied,
    options: () => ({ autoScale }),
    applyOptions: (o) => {
      applied.push(o);
    },
  };
}

test("re-asserts autoscale when it is still engaged (auto-fit member)", () => {
  const ps = fakePriceScale(true);
  const applied = reassertPriceAutoScale(ps);
  assert.equal(applied, true);
  assert.deepEqual(ps.applied, [{ autoScale: true }], "should nudge autoscale to reveal new walls/beads");
});

test("does NOT touch the scale when the member has manually zoomed (autoScale off)", () => {
  // This is the regression guard for the "I zoom in and a split second later it zooms out" bug:
  // once lightweight-charts flips autoScale to false on a manual drag, the per-tick refresh paths
  // must leave the member's vertical zoom alone.
  const ps = fakePriceScale(false);
  const applied = reassertPriceAutoScale(ps);
  assert.equal(applied, false);
  assert.deepEqual(ps.applied, [], "must never re-force autoScale over a manual member zoom");
});

test("treats a missing autoScale option as not-engaged (defensive)", () => {
  const applied: Array<{ autoScale: boolean }> = [];
  const ps: PriceScaleLike = { options: () => ({}), applyOptions: (o) => applied.push(o) };
  assert.equal(reassertPriceAutoScale(ps), false);
  assert.deepEqual(applied, []);
});
