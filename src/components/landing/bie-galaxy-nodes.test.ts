import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildGalaxyFieldNodes,
  countGalaxyFieldNodes,
  galaxyShapePath,
  GALAXY_NODE_RINGS,
  GALAXY_NODES_BY_RING,
  tickGalaxyFieldNodes,
} from "./bie-galaxy-nodes";

const CX = 640;
const CY = 360;
const MAX_RX = 640;
const MAX_RY = 310;

describe("buildGalaxyFieldNodes", () => {
  it("populates all six ellipses with inner rings denser than outer", () => {
    const nodes = buildGalaxyFieldNodes(CX, CY, MAX_RX, MAX_RY, 42);
    assert.equal(nodes.length, countGalaxyFieldNodes());
    assert.ok(nodes.length >= 90);

    for (const ring of GALAXY_NODE_RINGS) {
      const onRing = nodes.filter((n) => n.ring === ring);
      assert.equal(onRing.length, GALAXY_NODES_BY_RING[ring]);
    }

    assert.ok(GALAXY_NODES_BY_RING[1] > GALAXY_NODES_BY_RING[6]);
  });

  it("assigns varied shapes and behaviors", () => {
    const nodes = buildGalaxyFieldNodes(CX, CY, MAX_RX, MAX_RY, 7);
    const shapes = new Set(nodes.map((n) => n.shape));
    const behaviors = new Set(nodes.map((n) => n.behavior));
    assert.ok(shapes.size >= 4);
    assert.ok(behaviors.size >= 4);
  });

  it("is deterministic for the same seed", () => {
    const a = buildGalaxyFieldNodes(CX, CY, MAX_RX, MAX_RY, 99);
    const b = buildGalaxyFieldNodes(CX, CY, MAX_RX, MAX_RY, 99);
    assert.deepEqual(
      a.map((n) => [n.id, n.ring, n.shape, n.behavior, n.angleDeg.toFixed(2)]),
      b.map((n) => [n.id, n.ring, n.shape, n.behavior, n.angleDeg.toFixed(2)])
    );
  });
});

describe("tickGalaxyFieldNodes", () => {
  it("teleport nodes fade and jump to a new angle", () => {
    const nodes = buildGalaxyFieldNodes(CX, CY, MAX_RX, MAX_RY, 3);
    const tele = nodes.find((n) => n.behavior === "teleport");
    assert.ok(tele);

    const startAngle = tele!.angleDeg;
    tele!.nextTeleportAt = 0;
    tele!.teleportPhase = "visible";

    tickGalaxyFieldNodes(nodes, 0, 0.2, CX, CY, MAX_RX, MAX_RY);
    assert.equal(tele!.teleportPhase, "out");

    tickGalaxyFieldNodes(nodes, 0.2, 0.25, CX, CY, MAX_RX, MAX_RY);
    assert.equal(tele!.teleportPhase, "in");
    assert.notEqual(tele!.angleDeg, startAngle);

    tickGalaxyFieldNodes(nodes, 0.45, 0.8, CX, CY, MAX_RX, MAX_RY);
    assert.equal(tele!.teleportPhase, "visible");
    assert.ok(tele!.opacity > 0.2);
  });
});

describe("galaxyShapePath", () => {
  it("returns paths for filled shapes and null for ring", () => {
    assert.ok(galaxyShapePath("diamond", 4)?.startsWith("M"));
    assert.equal(galaxyShapePath("ring", 4), null);
  });
});
