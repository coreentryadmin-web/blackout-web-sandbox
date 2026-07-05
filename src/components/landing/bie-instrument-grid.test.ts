import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInstrumentGridRings, buildInstrumentGridSpokes } from "./bie-instrument-grid";

describe("buildInstrumentGridRings", () => {
  it("returns exactly `count` rings", () => {
    assert.equal(buildInstrumentGridRings(4, 640, 310).length, 4);
    assert.equal(buildInstrumentGridRings(1, 640, 310).length, 1);
    assert.equal(buildInstrumentGridRings(0, 640, 310).length, 0);
  });

  it("evenly spaces radii from small to the full maxRx/maxRy", () => {
    const rings = buildInstrumentGridRings(4, 640, 310);
    assert.deepEqual(
      rings.map((r) => r.rx),
      [160, 320, 480, 640]
    );
    assert.deepEqual(
      rings.map((r) => r.ry),
      [77.5, 155, 232.5, 310]
    );
  });

  it("preserves the maxRx/maxRy aspect ratio at every ring", () => {
    const rings = buildInstrumentGridRings(5, 640, 310);
    for (const r of rings) {
      assert.ok(Math.abs(r.rx / r.ry - 640 / 310) < 1e-9);
    }
  });
});

describe("buildInstrumentGridSpokes", () => {
  it("returns exactly `count` spokes", () => {
    assert.equal(buildInstrumentGridSpokes(8, 640, 310, 0.1).length, 8);
    assert.equal(buildInstrumentGridSpokes(0, 640, 310, 0.1).length, 0);
  });

  it("spaces spokes evenly by angle", () => {
    const spokes = buildInstrumentGridSpokes(4, 640, 310, 0.1);
    assert.deepEqual(
      spokes.map((s) => s.angleDeg),
      [0, 90, 180, 270]
    );
  });

  it("inner endpoint is exactly colinear with the outer endpoint and the origin", () => {
    for (const s of buildInstrumentGridSpokes(12, 640, 310, 0.08)) {
      // Cross product of the two endpoint vectors is 0 iff they're colinear through the origin.
      const cross = s.x1 * s.y2 - s.y1 * s.x2;
      assert.ok(Math.abs(cross) < 1e-9, `spoke at ${s.angleDeg}deg should be radial`);
    }
  });

  it("inner endpoint is closer to the origin than the outer endpoint", () => {
    for (const s of buildInstrumentGridSpokes(8, 640, 310, 0.1)) {
      const innerDist = Math.hypot(s.x1, s.y1);
      const outerDist = Math.hypot(s.x2, s.y2);
      assert.ok(innerDist < outerDist, `spoke at ${s.angleDeg}deg should point outward`);
    }
  });

  it("uses exactly innerFraction of the outer vector for the inner endpoint", () => {
    const [spoke] = buildInstrumentGridSpokes(1, 640, 310, 0.25);
    assert.equal(spoke.x1, spoke.x2 * 0.25);
    assert.equal(spoke.y1, spoke.y2 * 0.25);
  });
});
