import { test } from "node:test";
import assert from "node:assert/strict";
import { extendRangeForWalls, NEAREST_WALL_VIEW_MAX_PCT } from "./vector-price-range";

// Candle band ~7510–7600 around spot 7575 (the live staging case), put walls far below.
const base = { minValue: 7510, maxValue: 7600 };

test("extends DOWN to reveal a put wall below the candle band (the purple-beads bug)", () => {
  const out = extendRangeForWalls(base, 7575, [7600], [7400, 7300, 7200], 0.05);
  // 7300 is 3.6% below spot (within 5%) → range floor drops to include it (plus pad).
  assert.ok(out.minValue < 7300, `min ${out.minValue} should reach below 7300 to show the put wall`);
  assert.ok(out.maxValue >= 7600, "top unchanged (call wall already in band)");
});

test("does NOT extend for a wall beyond the HARD cap (avoids squishing candles for a far wall)", () => {
  // Nearest-wall guarantee caps at NEAREST_WALL_VIEW_MAX_PCT (12%). A put wall 20% below spot is
  // past both the dense window AND the hard cap → must be ignored so candles don't collapse.
  const farPut = 7575 * (1 - 0.2); // 6060
  const out = extendRangeForWalls(base, 7575, [7600], [farPut], 0.05);
  assert.equal(out.minValue, base.minValue, "put wall past the 12% hard cap → floor unchanged");
});

test("REGRESSION (purple beads): reveals the NEAREST put wall just PAST the 5% dense window", () => {
  // Live NVDA case: spot 210.58, nearest (only) put wall 197.5 = 6.2% below → just outside the 5%
  // dense window, so the member saw only yellow call beads. The nearest-wall guarantee must pull it
  // into view (it's within the 12% hard cap) so the purple put beads render.
  const nvdaBase = { minValue: 204, maxValue: 226 };
  const out = extendRangeForWalls(nvdaBase, 210.58, [210, 216, 220], [197.5], 0.05);
  assert.ok(out.minValue <= 197.5, `min ${out.minValue} must drop to reveal the 197.5 put wall`);
  assert.ok(NEAREST_WALL_VIEW_MAX_PCT >= 0.1, "hard cap is generous enough for a ~6% put wall");
});

test("reveals nearest wall on BOTH sides at once (gold + purple both visible)", () => {
  const tight = { minValue: 99, maxValue: 101 };
  // call wall 108 (+8%) and put wall 92 (−8%) both past the 5% window but within 12%.
  const out = extendRangeForWalls(tight, 100, [108], [92], 0.05);
  assert.ok(out.maxValue >= 108, "top rises to the nearest call wall");
  assert.ok(out.minValue <= 92, "bottom drops to the nearest put wall");
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
