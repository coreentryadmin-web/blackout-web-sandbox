import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGateTicks, resolveVerification, VERIFIED_PROBABILITY } from "./bie-verification";

describe("resolveVerification", () => {
  it("returns verified when rand is below the threshold", () => {
    assert.equal(resolveVerification(() => 0), "verified");
    assert.equal(resolveVerification(() => VERIFIED_PROBABILITY - 0.001), "verified");
  });

  it("returns rejected when rand is at or above the threshold", () => {
    assert.equal(resolveVerification(() => VERIFIED_PROBABILITY), "rejected");
    assert.equal(resolveVerification(() => 0.999), "rejected");
  });

  it("rejection is a real, non-negligible share — not vanishingly rare", () => {
    // A visible design requirement, not an implementation detail: rejections
    // must be common enough that a visitor watching for under a minute sees one.
    assert.ok(VERIFIED_PROBABILITY <= 0.9, "verified probability should leave a visible rejection rate");
    assert.ok(VERIFIED_PROBABILITY >= 0.6, "rejections shouldn't dominate — BIE is right most of the time");
  });

  it("over many draws with a real RNG, produces both outcomes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(resolveVerification(Math.random));
    assert.deepEqual([...seen].sort(), ["rejected", "verified"]);
  });
});

describe("buildGateTicks", () => {
  it("returns exactly `count` ticks", () => {
    assert.equal(buildGateTicks(12, 20, 30).length, 12);
    assert.equal(buildGateTicks(1, 20, 30).length, 1);
    assert.equal(buildGateTicks(0, 20, 30).length, 0);
  });

  it("spaces ticks evenly by angle", () => {
    const ticks = buildGateTicks(4, 20, 30);
    assert.deepEqual(
      ticks.map((t) => t.angleDeg),
      [0, 90, 180, 270]
    );
  });

  it("each tick's inner point is closer to origin than its outer point", () => {
    for (const t of buildGateTicks(8, 20, 30)) {
      const innerDist = Math.hypot(t.x1, t.y1);
      const outerDist = Math.hypot(t.x2, t.y2);
      assert.ok(outerDist > innerDist, `tick at ${t.angleDeg}deg should point outward`);
    }
  });

  it("is centered on the local origin (0,0) — caller translates to the core position", () => {
    const ticks = buildGateTicks(6, 20, 30);
    const avgX = ticks.reduce((s, t) => s + t.x1 + t.x2, 0) / (ticks.length * 2);
    const avgY = ticks.reduce((s, t) => s + t.y1 + t.y2, 0) / (ticks.length * 2);
    assert.ok(Math.abs(avgX) < 1e-9, "ticks should average out to origin on x");
    assert.ok(Math.abs(avgY) < 1e-9, "ticks should average out to origin on y");
  });
});
