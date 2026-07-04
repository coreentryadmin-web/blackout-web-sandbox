import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCenterHelix,
  buildHeroSweepPath,
  buildImpulsePath,
  buildIntelligenceRings,
  buildFlowParticles,
  buildStarField,
  flowParticlePosition,
  ellipsePath,
  placeCapability,
  ringRadii,
  type Capability,
} from "./bie-helix-engine";

const CX = 480;
const CY = 210;
const MAX_RX = 280;
const MAX_RY = 130;

describe("ringRadii", () => {
  it("orders five rings from inner to outer", () => {
    const r0 = ringRadii(0, MAX_RX, MAX_RY);
    const r4 = ringRadii(4, MAX_RX, MAX_RY);
    assert.ok(r4.rx > r0.rx);
    assert.ok(r4.ry > r0.ry);
  });
});

describe("buildHeroSweepPath", () => {
  it("spans from left edge to right edge through core", () => {
    const d = buildHeroSweepPath(1280, CY, CX, 12);
    assert.match(d, /^M 0 /);
    assert.match(d, /1280/);
    assert.match(d, new RegExp(`${CX} ${CY}`));
  });
});

describe("buildIntelligenceRings", () => {
  it("returns five rings with distinct motion", () => {
    const rings = buildIntelligenceRings(CX, CY, MAX_RX, MAX_RY);
    assert.equal(rings.length, 5);
    assert.ok(new Set(rings.map((r) => r.periodSec)).size >= 4);
  });
});

describe("buildCenterHelix", () => {
  it("builds two strands and rungs", () => {
    const h = buildCenterHelix(CX, CY, 300, 88);
    assert.match(h.strandA, /^M /);
    assert.match(h.strandB, /^M /);
    assert.equal(h.rungs.length, 24);
  });
});

describe("buildImpulsePath", () => {
  it("passes through core", () => {
    const d = buildImpulsePath(CX, CY, 30, MAX_RX, MAX_RY);
    assert.match(d, new RegExp(`${CX} ${CY}`));
  });
});

describe("placeCapability", () => {
  it("places on ring ellipse", () => {
    const cap: Capability = {
      id: "v",
      label: "Validation",
      detail: "d",
      angleDeg: 90,
      ring: 2,
      accent: "#00e676",
    };
    const p = placeCapability(CX, CY, cap, MAX_RX, MAX_RY);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  });
});

describe("ellipsePath", () => {
  it("starts at west point", () => {
    assert.match(ellipsePath(CX, CY, 100, 50), new RegExp(`M ${CX - 100} ${CY}`));
  });
});

describe("buildStarField", () => {
  it("is deterministic at count", () => {
    assert.deepEqual(
      buildStarField(CX, CY, MAX_RX, MAX_RY, 300),
      buildStarField(CX, CY, MAX_RX, MAX_RY, 300)
    );
  });
});

describe("buildFlowParticles", () => {
  it("returns inward-drifting particles", () => {
    const flows = buildFlowParticles(32);
    assert.equal(flows.length, 32);
    assert.ok(flows.every((p) => p.dist > 0 && p.speed > 0));
  });
});

describe("flowParticlePosition", () => {
  it("maps dist/angle to coordinates", () => {
    const p = buildFlowParticles(1)[0];
    const pos = flowParticlePosition(CX, CY, MAX_RX, MAX_RY, p);
    assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y));
  });
});
