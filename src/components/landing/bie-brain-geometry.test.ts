import { test } from "node:test";
import assert from "node:assert/strict";
import { chordPath, goldenSpiralPoint, pointOnEllipse } from "./bie-brain-geometry";

test("pointOnEllipse: angle 0 lands straight above the center, ry away", () => {
  const p = pointOnEllipse(100, 100, 50, 20, 0);
  assert.ok(Math.abs(p.x - 100) < 1e-9);
  assert.ok(Math.abs(p.y - 80) < 1e-9);
});

test("pointOnEllipse: angle 90 lands directly right of the center, rx away", () => {
  const p = pointOnEllipse(100, 100, 50, 20, 90);
  assert.ok(Math.abs(p.x - 150) < 1e-9);
  assert.ok(Math.abs(p.y - 100) < 1e-9);
});

test("pointOnEllipse: rx === ry behaves as a true circle — every angle is radius away", () => {
  for (let i = 0; i < 6; i++) {
    const p = pointOnEllipse(0, 0, 40, 40, i * 60);
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - 40) < 1e-9);
  }
});

test("chordPath: bow=0 degenerates to a straight-line quadratic (control point = midpoint)", () => {
  const d = chordPath(0, 0, 100, 0, 50, 200, 0);
  assert.equal(d, "M0,0 Q50,0 100,0");
});

test("chordPath: bows away from the center along the center→midpoint direction", () => {
  // center below the chord's midpoint → bow pushes the control point further up (away from center)
  const d = chordPath(0, 100, 100, 100, 50, 300, 40);
  const [, cy] = d.match(/Q\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/)!;
  assert.ok(Number(cy) < 100, "control point should move away from the center, not toward it");
});

test("goldenSpiralPoint: every point stays within the ellipse's bounding radii of the center", () => {
  for (let i = 0; i < 30; i++) {
    const p = goldenSpiralPoint(0, 0, 100, 50, i, 30);
    assert.ok(Math.abs(p.x) <= 100 + 1e-6);
    assert.ok(Math.abs(p.y) <= 50 + 1e-6);
  }
});

test("goldenSpiralPoint: is deterministic — same inputs, same outputs", () => {
  assert.deepEqual(goldenSpiralPoint(10, 20, 80, 40, 5, 24), goldenSpiralPoint(10, 20, 80, 40, 5, 24));
});

test("goldenSpiralPoint: successive points land at different radii (spreads across the disc, not a single ring)", () => {
  const radii = Array.from({ length: 10 }, (_, i) => {
    const p = goldenSpiralPoint(0, 0, 100, 100, i, 10);
    return Math.hypot(p.x, p.y);
  });
  assert.equal(new Set(radii.map((r) => Math.round(r))).size > 1, true);
});
