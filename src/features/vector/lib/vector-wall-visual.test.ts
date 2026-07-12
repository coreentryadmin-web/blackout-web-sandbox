import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alphaForPct,
  markerSizeForPct,
  radiusForPct,
  widthForPct,
  MODELED_ALPHA_SCALE,
} from "./vector-wall-visual";

test("alphaForPct: a 0% wall gets the faint visual floor, not fully invisible", () => {
  assert.equal(alphaForPct(0), 0.05);
});

test("alphaForPct: a wall at or above the saturation point (7%) gets full opacity", () => {
  assert.equal(alphaForPct(7), 1);
  assert.equal(alphaForPct(35), 1); // above saturation clamps, doesn't overshoot
});

test("alphaForPct: scales monotonically with magnitude below saturation", () => {
  assert.ok(alphaForPct(2) < alphaForPct(4));
  assert.ok(alphaForPct(4) < alphaForPct(6));
});

test("HIGH CONTRAST: a dominant wall reads dramatically bolder/brighter than a weak one", () => {
  // The whole point of the Skylit-style retune: an ~8% session-king vs a ~1% straggler must
  // NOT wash out to similar weight. Opacity ratio ≥ 4×, bead-size ratio ≥ 3×.
  assert.ok(alphaForPct(8) / alphaForPct(1) >= 4, "strong wall ≥4× the opacity of a weak one");
  assert.ok(markerSizeForPct(8) / markerSizeForPct(1) >= 3, "strong bead ≥3× the size of a weak one");
});

test("alphaForPct: treats non-finite/negative input as zero magnitude", () => {
  assert.equal(alphaForPct(NaN), 0.05);
  assert.equal(alphaForPct(-5), 0.05);
});

test("widthForPct: stays within lightweight-charts' 1-4 LineWidth union across the full range", () => {
  for (const pct of [0, 1, 5, 10, 15, 20, 50, 100]) {
    const w = widthForPct(pct);
    assert.ok(w >= 1 && w <= 4, `widthForPct(${pct}) = ${w} out of range`);
    assert.ok(Number.isInteger(w));
  }
});

test("widthForPct: a dominant wall (>= saturation) renders at max thickness; near-zero at min", () => {
  assert.equal(widthForPct(7), 4);
  assert.equal(widthForPct(0), 1);
});

test("radiusForPct: stays within the 2-6px trail-dot range and scales monotonically", () => {
  assert.equal(radiusForPct(0), 2);
  assert.equal(radiusForPct(7), 6);
  assert.ok(radiusForPct(3) < radiusForPct(6));
});

test("markerSizeForPct: per-bead sizes span the Skylit-style range", () => {
  assert.equal(markerSizeForPct(0), 0.5);
  assert.equal(markerSizeForPct(7), 2.8);
  assert.ok(markerSizeForPct(3) < markerSizeForPct(6));
});

test("MODELED_ALPHA_SCALE: modeled beads render as a FAINT ghost (< observed) but not invisible", () => {
  // Faint enough to read as a ghosted secondary underlay — verified live that 0.4 was too bright
  // (a 30% wall still looked solid/full-width). Must stay well under a quarter of observed weight,
  // and above zero so it never fully vanishes.
  assert.ok(MODELED_ALPHA_SCALE > 0 && MODELED_ALPHA_SCALE <= 0.2);
  // Even the session-king strike is a quiet ghost: a full-strength modeled bead is dimmer than a
  // MID-strength observed bead, so a real recorded sample always reads as "more real."
  assert.ok(alphaForPct(100) * MODELED_ALPHA_SCALE < alphaForPct(3));
});
