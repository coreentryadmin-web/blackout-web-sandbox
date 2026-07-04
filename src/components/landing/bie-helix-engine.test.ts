import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAmbientFieldMesh,
  buildAtmosphereGlows,
  buildCenterHelix,
  buildFieldLinePath,
  buildFieldLineRings,
  buildFieldParticles,
  buildHeroSweepPath,
  buildImpulsePath,
  buildInboundPulsePath,
  buildInnerFieldNodes,
  buildIntelligenceRings,
  buildFlowParticles,
  buildNeuralNodes,
  buildRingFieldNodes,
  buildRingSegmentPath,
  buildStarField,
  fieldGlowRadii,
  flowParticlePosition,
  ellipsePath,
  placeCapability,
  pointOnFieldLine,
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

describe("buildFieldParticles", () => {
  it("fills the viewport intelligence field", () => {
    const field = buildFieldParticles(240, 1280, 720, CX, CY, MAX_RX, MAX_RY);
    assert.equal(field.length, 240);
    assert.ok(field.every((p) => p.life > 0 && p.opacity > 0.02 && p.opacity < 0.16));
    assert.ok(field.every((p) => p.size >= 1.3));
  });
});

describe("buildNeuralNodes", () => {
  it("places nodes on rings", () => {
    const nodes = buildNeuralNodes(22, CX, CY, MAX_RX, MAX_RY);
    assert.equal(nodes.length, 22);
    assert.ok(nodes.every((n) => Number.isFinite(n.x) && n.ring >= 0));
  });
});

describe("buildInboundPulsePath", () => {
  it("curves from field point to core", () => {
    const d = buildInboundPulsePath(100, 120, CX, CY);
    assert.match(d, new RegExp(`M 100\\.0 120\\.0`));
    assert.match(d, new RegExp(`${CX} ${CY}`));
  });
});

describe("fieldGlowRadii", () => {
  it("covers roughly half the hero", () => {
    const g = fieldGlowRadii(1280, 720);
    assert.ok(g.rx > 500);
    assert.ok(g.ry > 300);
  });
});

describe("buildFieldLinePath", () => {
  it("closes an organic loop distinct from a perfect ellipse", () => {
    const organic = buildFieldLinePath(CX, CY, MAX_RX, MAX_RY, 0.64, 3);
    const perfect = ellipsePath(CX, CY, MAX_RX * 0.64, MAX_RY * 0.64);
    assert.match(organic, /^M \d/);
    assert.match(organic, / Z$/);
    assert.notEqual(organic, perfect);
  });
});

describe("buildFieldLineRings", () => {
  it("returns six layered rings from inner through outer field", () => {
    const rings = buildFieldLineRings(CX, CY, MAX_RX, MAX_RY);
    assert.equal(rings.length, 6);
    assert.deepEqual(
      rings.map((r) => r.layer),
      ["inner", "inner", "mid", "mid", "outer", "outer"]
    );
    assert.ok(rings.every((r) => r.d.length > 40));
  });

  it("outermost ring uses full maxRx scale", () => {
    const rings = buildFieldLineRings(CX, CY, MAX_RX, MAX_RY);
    const outer = rings.find((r) => r.ring === 6)!;
    assert.equal(outer.scale, 1);
    const right = pointOnFieldLine(CX, CY, MAX_RX, MAX_RY, outer.scale, 6, 90);
    const left = pointOnFieldLine(CX, CY, MAX_RX, MAX_RY, outer.scale, 6, 270);
    assert.ok(right.x - left.x >= MAX_RX * 1.75, "outer ring should span nearly 2× maxRx");
  });
});

describe("buildAtmosphereGlows", () => {
  it("layers three volumetric glow tiers", () => {
    const glows = buildAtmosphereGlows(CX, CY, MAX_RX, MAX_RY);
    assert.equal(glows.length, 3);
    assert.ok(glows[0].rx > glows[2].rx);
  });
});

describe("buildAmbientFieldMesh", () => {
  it("creates sparse depth lines across the field", () => {
    const mesh = buildAmbientFieldMesh(CX, CY, MAX_RX, MAX_RY);
    assert.equal(mesh.length, 14);
    assert.ok(mesh.every((l) => l.d.startsWith("M")));
  });
});

describe("pointOnFieldLine", () => {
  it("places coordinates on the distorted path", () => {
    const p = pointOnFieldLine(CX, CY, MAX_RX, MAX_RY, 0.38, 2, 0);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(Math.hypot(p.x - CX, p.y - CY) > 20);
  });
});

describe("buildInnerFieldNodes", () => {
  it("places nodes only on inner field rings", () => {
    const nodes = buildInnerFieldNodes(CX, CY, MAX_RX, MAX_RY, [1, 2], 6);
    assert.equal(nodes.length, 12);
    assert.ok(nodes.every((n) => n.ring === 1 || n.ring === 2));
  });
});

describe("buildRingFieldNodes", () => {
  it("delegates to inner rings only", () => {
    const nodes = buildRingFieldNodes(CX, CY, MAX_RX, MAX_RY, [1, 2, 3, 4], 5);
    assert.equal(nodes.length, 10);
    assert.ok(nodes.every((n) => Number.isFinite(n.x)));
  });
});

describe("buildRingSegmentPath", () => {
  it("connects adjacent nodes with a bowed path", () => {
    const nodes = buildRingFieldNodes(CX, CY, MAX_RX, MAX_RY, [2], 3);
    const d = buildRingSegmentPath(nodes[0].x, nodes[0].y, nodes[1].x, nodes[1].y, CX, CY, 12);
    assert.match(d, /^M[\d.-]/);
  });
});
