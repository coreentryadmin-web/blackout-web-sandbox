import { test } from "node:test";
import assert from "node:assert/strict";
import { extendRangeForWalls } from "./vector-price-range";

// Candle band ~7510–7600 around spot 7575 (the live staging case), put walls far below.
const base = { minValue: 7510, maxValue: 7600 };

test("extends DOWN to reveal a put wall below the candle band (the purple-beads bug)", () => {
  const out = extendRangeForWalls(base, 7575, [7600], [7400, 7300, 7200], 0.05);
  // 7300 is 3.6% below spot (within 5%) → range floor drops to include it (plus pad).
  assert.ok(out.minValue < 7300, `min ${out.minValue} should reach below 7300 to show the put wall`);
  assert.ok(out.maxValue >= 7600, "top unchanged (call wall already in band)");
});

test("does NOT extend for a wall beyond the cap (avoids squishing candles for a far wall)", () => {
  // maxPct 2% → floor 7423.5; 7300/7200 are further than 2% so must be ignored.
  const out = extendRangeForWalls(base, 7575, [7600], [7300, 7200], 0.02);
  assert.equal(out.minValue, base.minValue, "no in-band put wall → floor unchanged");
});

test("extends UP to reveal a call wall above the candle band", () => {
  const tight = { minValue: 7560, maxValue: 7580 };
  const out = extendRangeForWalls(tight, 7575, [7620], [], 0.05);
  assert.ok(out.maxValue > 7620, "top rises to include the 7620 call wall + pad");
});

test("no change when all walls already sit inside the candle band", () => {
  const out = extendRangeForWalls(base, 7575, [7590], [7520], 0.05);
  assert.deepEqual(out, base);
});

test("null/zero spot or empty walls → returns base untouched, never throws", () => {
  assert.deepEqual(extendRangeForWalls(base, null, [7400], [7300], 0.05), base);
  assert.deepEqual(extendRangeForWalls(base, 7575, [], [], 0.05), base);
  assert.deepEqual(extendRangeForWalls(base, 7575, [NaN, 0], [NaN], 0.05), base);
});
