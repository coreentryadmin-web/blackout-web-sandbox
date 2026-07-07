import { test } from "node:test";
import assert from "node:assert/strict";
import { alphaForPct, radiusForPct, widthForPct } from "./vector-wall-visual";

test("alphaForPct: a 0% wall gets the visual floor, not fully invisible", () => {
  assert.equal(alphaForPct(0), 0.25);
});

test("alphaForPct: a wall at or above the saturation point (20%) gets full opacity", () => {
  assert.equal(alphaForPct(20), 1);
  assert.equal(alphaForPct(35), 1); // above saturation clamps, doesn't overshoot
});

test("alphaForPct: scales monotonically with magnitude between the floor and saturation", () => {
  assert.ok(Math.abs(alphaForPct(10) - 0.625) < 1e-9); // 0.25 + (10/20) * 0.75
  assert.ok(alphaForPct(5) < alphaForPct(10));
  assert.ok(alphaForPct(10) < alphaForPct(15));
});

test("alphaForPct: two walls close in magnitude look nearly identical, unlike rank-based fading", () => {
  // A 9% wall and an 8% wall are nearly the same size — the old rank-based scheme would have
  // rendered them at 1.0 and 0.65 opacity purely for being 1st vs 2nd; magnitude-based scaling
  // should keep them close together.
  const a = alphaForPct(9);
  const b = alphaForPct(8);
  assert.ok(Math.abs(a - b) < 0.05);
});

test("alphaForPct: treats non-finite/negative input as zero magnitude", () => {
  assert.equal(alphaForPct(NaN), 0.25);
  assert.equal(alphaForPct(-5), 0.25);
});

test("widthForPct: stays within lightweight-charts' 1-4 LineWidth union across the full range", () => {
  for (const pct of [0, 1, 5, 10, 15, 20, 50, 100]) {
    const w = widthForPct(pct);
    assert.ok(w >= 1 && w <= 4, `widthForPct(${pct}) = ${w} out of range`);
    assert.ok(Number.isInteger(w));
  }
});

test("widthForPct: a dominant wall (>= saturation) renders at max thickness", () => {
  assert.equal(widthForPct(20), 4);
});

test("widthForPct: a near-zero wall renders at min thickness", () => {
  assert.equal(widthForPct(0), 1);
});

test("radiusForPct: stays within the 2-5px trail-dot range and scales monotonically", () => {
  assert.equal(radiusForPct(0), 2);
  assert.equal(radiusForPct(20), 5);
  assert.ok(radiusForPct(5) < radiusForPct(10));
  assert.ok(radiusForPct(10) < radiusForPct(15));
});
