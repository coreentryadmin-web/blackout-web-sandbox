import { test } from "node:test";
import assert from "node:assert/strict";
import { computeExpectedMove, expectedMoveCallouts } from "./vector-expected-move";

test("computeExpectedMove: 1σ = spot·σ·√(t) and k·σ bands are symmetric around spot", () => {
  // spot 7500, IV 16%, 4 calendar days → t = 4/365, move1 = 7500·0.16·√(4/365).
  const spot = 7500;
  const atmIv = 0.16;
  const dteDays = 4;
  const em = computeExpectedMove({ spot, atmIv, dteDays });
  assert.ok(em, "should compute with valid inputs");
  const move1 = spot * atmIv * Math.sqrt(dteDays / 365);
  const one = em!.bands.find((b) => b.sigma === 1)!;
  const two = em!.bands.find((b) => b.sigma === 2)!;
  assert.ok(Math.abs(one.movePts - move1) < 1e-9, "1σ points match the closed form");
  assert.ok(Math.abs(two.movePts - 2 * move1) < 1e-9, "2σ is exactly double 1σ");
  // Bands symmetric around spot.
  assert.ok(Math.abs((one.high + one.low) / 2 - spot) < 1e-9);
  assert.ok(Math.abs(em!.movePct - move1 / spot) < 1e-12, "movePct is move1/spot");
  // Default bands are exactly [1σ, 2σ] ascending.
  assert.deepEqual(em!.bands.map((b) => b.sigma), [1, 2]);
});

test("computeExpectedMove: degenerate inputs return null, never a fabricated band", () => {
  assert.equal(computeExpectedMove({ spot: 0, atmIv: 0.16, dteDays: 4 }), null, "spot 0");
  assert.equal(computeExpectedMove({ spot: 7500, atmIv: 0, dteDays: 4 }), null, "iv 0");
  assert.equal(computeExpectedMove({ spot: 7500, atmIv: 0.16, dteDays: 0 }), null, "0DTE literal 0");
  assert.equal(computeExpectedMove({ spot: 7500, atmIv: -0.1, dteDays: 4 }), null, "negative iv");
  assert.equal(computeExpectedMove({ spot: 7500, atmIv: 0.16, dteDays: -1 }), null, "negative dte");
  assert.equal(computeExpectedMove({ spot: NaN, atmIv: 0.16, dteDays: 4 }), null, "NaN spot");
  assert.equal(computeExpectedMove({ spot: 7500, atmIv: Infinity, dteDays: 4 }), null, "inf iv");
});

test("computeExpectedMove: 0DTE via fractional session-remaining days produces a real narrow band", () => {
  // ~3h left in a 6.5h session ≈ 0.46 of a trading day. Passed as a fraction of a day.
  const em = computeExpectedMove({ spot: 7500, atmIv: 0.16, dteDays: 3 / 24 });
  assert.ok(em, "fractional dte is valid");
  const one = em!.bands.find((b) => b.sigma === 1)!;
  assert.ok(one.movePts > 0 && one.movePts < 7500 * 0.16, "narrow but non-zero intraday move");
});

test("computeExpectedMove: low-priced name — 2σ lower bound is floored at 0, never negative", () => {
  // A cheap, very-high-IV name where 2σ would arithmetically go below zero.
  const em = computeExpectedMove({ spot: 5, atmIv: 3.0, dteDays: 30 });
  assert.ok(em);
  const two = em!.bands.find((b) => b.sigma === 2)!;
  assert.equal(two.low, 0, "lower band clamped to 0, not a negative price");
  assert.ok(two.high > 5, "upper band still above spot");
});

test("computeExpectedMove: custom sigmas are sanitized (dedup, drop non-positive, sort ascending)", () => {
  const em = computeExpectedMove({ spot: 100, atmIv: 0.2, dteDays: 10 }, [2, 1, 1, 0, -1, 3]);
  assert.ok(em);
  assert.deepEqual(em!.bands.map((b) => b.sigma), [1, 2, 3], "deduped, positives only, ascending");
  // All-invalid sigma set → null (nothing to draw).
  assert.equal(computeExpectedMove({ spot: 100, atmIv: 0.2, dteDays: 10 }, [0, -1, NaN]), null);
});

test("expectedMoveCallouts: formats one line per band; % only on the 1σ line; empty on null", () => {
  const em = computeExpectedMove({ spot: 7500, atmIv: 0.16, dteDays: 4 });
  const lines = expectedMoveCallouts(em);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^1σ expected move: ±[\d,.]+ pts \(\d+\.\d{2}%\) → [\d,.]+–[\d,.]+$/);
  assert.match(lines[1]!, /^2σ expected move: ±[\d,.]+ pts → [\d,.]+–[\d,.]+$/);
  assert.ok(!lines[1]!.includes("%"), "only the 1σ line carries the headline percent");
  assert.deepEqual(expectedMoveCallouts(null), [], "null → no lines");
});
