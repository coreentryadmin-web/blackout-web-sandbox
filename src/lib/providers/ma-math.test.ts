import { test } from "node:test";
import assert from "node:assert/strict";
import { smaFromCloses, emaFromCloses } from "./ma-math";

test("smaFromCloses averages the last `window` closes; null when too few", () => {
  assert.equal(smaFromCloses([3, 4, 5], 3), 4);
  assert.equal(smaFromCloses([1, 2, 3, 4, 10], 3), (3 + 4 + 10) / 3); // last 3 only
  assert.equal(smaFromCloses([1, 2], 3), null); // fewer bars than window
  assert.equal(smaFromCloses([1, 2, 3], 0), null);
});

test("emaFromCloses: SMA-seeded then iterated (known sequence)", () => {
  // closes [1,2,3,4,10], window 3: seed=(1+2+3)/3=2, k=0.5
  //   i=3: 4*0.5 + 2*0.5 = 3
  //   i=4: 10*0.5 + 3*0.5 = 6.5
  assert.equal(emaFromCloses([1, 2, 3, 4, 10], 3), 6.5);
  // exactly `window` bars → EMA == SMA(window) (no iteration)
  assert.equal(emaFromCloses([2, 4, 6], 3), 4);
  assert.equal(emaFromCloses([1, 2], 3), null);
});

test("emaFromCloses weights recent bars more than smaFromCloses", () => {
  // Flat then a recent jump up: EMA weights the latest bar more, so EMA > SMA.
  // closes [10,10,10,10,10,20] window 5: SMA last5=(10+10+10+10+20)/5=12;
  //   EMA seed=10, k=1/3, i=5: 20/3 + 10*2/3 = 13.333 → EMA > SMA.
  const closes = [10, 10, 10, 10, 10, 20];
  const ema = emaFromCloses(closes, 5)!;
  const sma = smaFromCloses(closes, 5)!;
  assert.ok(ema > sma, `expected EMA ${ema} > SMA ${sma} after a recent up-move`);
  // (a perfectly linear ramp gives EMA == SMA — they only diverge on acceleration.)
});
