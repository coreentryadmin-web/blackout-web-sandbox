import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCenterHelix,
  buildImpulsePath,
  buildIntelligenceRings,
  buildStarField,
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
  it("orders four rings from inner to outer", () => {
    const r0 = ringRadii(0, MAX_RX, MAX_RY);
    const r3 = ringRadii(3, MAX_RX, MAX_RY);
    assert.ok(r3.rx > r0.rx);
    assert.ok(r3.ry > r0.ry);
  });
});

describe("buildIntelligenceRings", () => {
  it("returns four rings with distinct motion", () => {
    const rings = buildIntelligenceRings(CX, CY, MAX_RX, MAX_RY);
    assert.equal(rings.length, 4);
    assert.ok(new Set(rings.map((r) => r.periodSec)).size >= 3);
  });
});

describe("buildCenterHelix", () => {
  it("builds two strands and rungs", () => {
    const h = buildCenterHelix(CX, CY, 300, 88);
    assert.match(h.strandA, /^M /);
    assert.match(h.strandB, /^M /);
    assert.equal(h.rungs.length, 18);
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
