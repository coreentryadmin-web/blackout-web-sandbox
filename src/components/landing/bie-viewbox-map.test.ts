import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { advanceOrbitDeg, oscillationAngleDeg, viewBoxPointToContainer } from "@/components/landing/bie-viewbox-map";

describe("viewBoxPointToContainer", () => {
  it("maps center with slice scaling", () => {
    const p = viewBoxPointToContainer(640, 370, 1280, 720, 1280, 740, "slice");
    assert.equal(p.x, 640);
    assert.equal(p.y, 360);
    assert.ok(p.scale >= 1);
  });

  it("uses meet scaling without upscaling beyond container", () => {
    const p = viewBoxPointToContainer(640, 370, 1280, 720, 1280, 740, "meet");
    assert.equal(p.x, 640);
    assert.ok(p.y > 0);
    assert.ok(p.scale <= 1);
  });
});

describe("advanceOrbitDeg", () => {
  it("advances phase proportional to elapsed time", () => {
    const next = advanceOrbitDeg(0, 12, 96);
    assert.equal(next, 45);
  });

  it("supports reverse direction", () => {
    const next = advanceOrbitDeg(0, 12, 96, -1);
    assert.equal(next, 315);
  });

  it("wraps at 360 degrees", () => {
    const next = advanceOrbitDeg(350, 4, 96);
    assert.ok(next < 360);
    assert.ok(next > 0);
  });
});

describe("oscillationAngleDeg", () => {
  it("returns exactly the anchor when orbitDeg is 0", () => {
    assert.equal(oscillationAngleDeg(42, 0, 24), 42);
  });

  it("never leaves [anchor - amplitude, anchor + amplitude] for any phase", () => {
    const anchor = 138;
    const amplitude = 24;
    for (let phase = 0; phase < 360; phase += 5) {
      const angle = oscillationAngleDeg(anchor, phase, amplitude);
      assert.ok(angle >= anchor - amplitude - 1e-9, `phase ${phase}: ${angle} below range`);
      assert.ok(angle <= anchor + amplitude + 1e-9, `phase ${phase}: ${angle} above range`);
    }
  });

  it("reaches both extremes over a full phase cycle (it's a real swing, not stuck at the anchor)", () => {
    const anchor = 268;
    const amplitude = 24;
    const angles = Array.from({ length: 72 }, (_, i) => oscillationAngleDeg(anchor, i * 5, amplitude));
    assert.ok(Math.max(...angles) > anchor + amplitude - 0.5);
    assert.ok(Math.min(...angles) < anchor - amplitude + 0.5);
  });

  it("a zero amplitude pins the tool exactly at its anchor regardless of phase", () => {
    assert.equal(oscillationAngleDeg(178, 90, 0), 178);
    assert.equal(oscillationAngleDeg(178, 270, 0), 178);
  });
});
