import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectPivots,
  latestSwing,
  swingRetracement,
  goldenPocket,
} from "./vector-fib-swing";

/** Bars from a price path: high = p + 0.5, low = p − 0.5 keeps extremes unambiguous. */
const barsFrom = (path: number[]) =>
  path.map((p, i) => ({ time: 60 * i, high: p + 0.5, low: p - 0.5 }));

test("detectPivots: fractal highs/lows with k=2, flat extremes crown the FIRST bar only", () => {
  //             0    1    2    3    4    5    6    7    8
  const path = [100, 102, 105, 103, 101, 99, 97, 99, 100];
  const { highs, lows } = detectPivots(barsFrom(path), 2);
  assert.deepEqual(highs.map((h) => h.index), [2], "single pivot high at the 105 bar");
  assert.deepEqual(lows.map((l) => l.index), [6], "single pivot low at the 97 bar");
  assert.equal(highs[0]!.price, 105.5);
  assert.equal(lows[0]!.price, 96.5);

  // Flat top: two equal highs — only the FIRST is crowned (left ties allowed, right strict).
  const flat = [100, 103, 103, 100, 98, 98, 100];
  const p2 = detectPivots(barsFrom(flat), 1);
  assert.deepEqual(p2.highs.map((h) => h.index), [1], "flat top crowns first bar");
  assert.deepEqual(p2.lows.map((l) => l.index), [4], "flat bottom crowns first bar");
});

test("detectPivots: needs 2k+1 bars and a positive k; last k bars can't confirm", () => {
  assert.deepEqual(detectPivots(barsFrom([1, 2, 3]), 2), { highs: [], lows: [] });
  assert.deepEqual(detectPivots(barsFrom([1, 2, 3]), 0), { highs: [], lows: [] });
  // A rising path's max is at the unconfirmable right edge → no pivot high.
  const rising = detectPivots(barsFrom([1, 2, 3, 4, 5, 6, 7]), 2);
  assert.equal(rising.highs.length, 0, "edge max unconfirmed");
});

test("latestSwing: down swing (high before low) and up swing (low before high)", () => {
  // High pivot (idx 2, 105.5) then low pivot (idx 6, 96.5) → DOWN swing.
  const down = latestSwing(barsFrom([100, 102, 105, 103, 101, 99, 97, 99, 100]), 2)!;
  assert.equal(down.direction, "down");
  assert.equal(down.from.index, 2);
  assert.equal(down.to.index, 6);
  assert.equal(down.high, 105.5);
  assert.equal(down.low, 96.5);

  // Mirror path → UP swing.
  const up = latestSwing(barsFrom([100, 98, 95, 97, 99, 101, 103, 101, 100]), 2)!;
  assert.equal(up.direction, "up");
  assert.equal(up.from.price, 94.5);
  assert.equal(up.to.price, 103.5);
});

test("latestSwing: null without both pivots", () => {
  assert.equal(latestSwing(barsFrom([1, 2, 3, 4, 5, 6, 7]), 2), null);
});

test("swingRetracement: measured from the terminus back toward the origin, per direction", () => {
  // Up swing 90→110 (range 20): 0% = 110 (the high), 61.8% = 110 − 12.36 = 97.64, 100% = 90.
  const up = { from: { index: 0, time: 0, price: 90 }, to: { index: 5, time: 300, price: 110 }, direction: "up" as const, high: 110, low: 90 };
  assert.equal(swingRetracement(up, 0), 110);
  assert.equal(swingRetracement(up, 1), 90);
  assert.ok(Math.abs(swingRetracement(up, 0.618) - 97.64) < 1e-9);

  // Down swing 110→90: 0% = 90 (the low), 61.8% = 90 + 12.36 = 102.36, 100% = 110.
  const down = { ...up, direction: "down" as const, from: up.to, to: up.from };
  assert.equal(swingRetracement(down, 0), 90);
  assert.equal(swingRetracement(down, 1), 110);
  assert.ok(Math.abs(swingRetracement(down, 0.618) - 102.36) < 1e-9);
});

test("goldenPocket: the 61.8–65% zone, returned low-to-high regardless of direction", () => {
  const up = { from: { index: 0, time: 0, price: 90 }, to: { index: 5, time: 300, price: 110 }, direction: "up" as const, high: 110, low: 90 };
  const gpUp = goldenPocket(up); // 110 − 0.618·20 = 97.64 ; 110 − 0.65·20 = 97.0
  assert.ok(Math.abs(gpUp.top - 97.64) < 1e-9 && Math.abs(gpUp.bottom - 97.0) < 1e-9);

  const down = { ...up, direction: "down" as const, from: up.to, to: up.from };
  const gpDown = goldenPocket(down); // 90 + 0.618·20 = 102.36 ; 90 + 0.65·20 = 103.0
  assert.ok(Math.abs(gpDown.bottom - 102.36) < 1e-9 && Math.abs(gpDown.top - 103.0) < 1e-9);
  assert.ok(gpDown.top > gpDown.bottom, "always low-to-high in price");
});
