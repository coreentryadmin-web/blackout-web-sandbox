import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrbitTool } from "./BieOrbitTools";
import {
  ORBIT_PAIR_SEPARATION_DEG,
  buildRandomFieldNodes,
  buildRandomOrbitLayout,
  orbitAngularSeparationDeg,
} from "./bie-orbit-layout";

const TOOLS: OrbitTool[] = [
  { name: "A", href: "/a", mark: "spx", accent: "#0f0" },
  { name: "B", href: "/b", mark: "helix", accent: "#00f" },
  { name: "C", href: "/c", mark: "heatmap", accent: "#f00" },
  { name: "D", href: "/d", mark: "grid", accent: "#ff0" },
  { name: "E", href: "/e", mark: "largo", accent: "#0ff" },
  { name: "F", href: "/f", mark: "nighthawk", accent: "#f0f" },
];

const SCALES = { 4: 0.72, 5: 0.88, 6: 1 } as const;

describe("buildRandomOrbitLayout", () => {
  it("places two tools on each of rings 4, 5, and 6", () => {
    const layout = buildRandomOrbitLayout(TOOLS, SCALES, 42);
    assert.equal(layout.length, 6);
    for (const ring of [4, 5, 6] as const) {
      assert.equal(layout.filter((t) => t.orbitRing === ring).length, 2);
    }
  });

  it("keeps ring pairs 180° apart with shared speed and direction", () => {
    const layout = buildRandomOrbitLayout(TOOLS, SCALES, 42);
    for (const ring of [4, 5, 6] as const) {
      const pair = layout.filter((t) => t.orbitRing === ring);
      assert.equal(pair.length, 2);
      const sep = orbitAngularSeparationDeg(pair[0].startAngleDeg, pair[1].startAngleDeg);
      assert.ok(Math.abs(sep - ORBIT_PAIR_SEPARATION_DEG) < 0.01);
      assert.equal(pair[0].orbitPeriodSec, pair[1].orbitPeriodSec);
      assert.equal(pair[0].orbitDirection, pair[1].orbitDirection);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = buildRandomOrbitLayout(TOOLS, SCALES, 99);
    const b = buildRandomOrbitLayout(TOOLS, SCALES, 99);
    assert.deepEqual(
      a.map((t) => [t.name, t.orbitRing, t.startAngleDeg.toFixed(2)]),
      b.map((t) => [t.name, t.orbitRing, t.startAngleDeg.toFixed(2)])
    );
  });

  it("varies layout across seeds", () => {
    const a = buildRandomOrbitLayout(TOOLS, SCALES, 1);
    const b = buildRandomOrbitLayout(TOOLS, SCALES, 2);
    const same =
      a.every((t, i) => t.name === b[i].name && t.orbitRing === b[i].orbitRing) &&
      a.every((t, i) => Math.abs(t.startAngleDeg - b[i].startAngleDeg) < 0.01);
    assert.equal(same, false);
  });
});

describe("buildRandomFieldNodes", () => {
  it("places random nodes on outer ellipses 4, 5, and 6", () => {
    const nodes = buildRandomFieldNodes(640, 360, 640, 310, 4, 7);
    assert.equal(nodes.length, 12);
    assert.ok(nodes.every((n) => n.ring === 4 || n.ring === 5 || n.ring === 6));
    assert.ok(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  });

  it("varies node angles across seeds", () => {
    const a = buildRandomFieldNodes(640, 360, 640, 310, 3, 1);
    const b = buildRandomFieldNodes(640, 360, 640, 310, 3, 2);
    const sameAngles = a.every((n, i) => {
      const other = b[i];
      return other && n.ring === other.ring && Math.abs(n.x - other.x) < 0.01 && Math.abs(n.y - other.y) < 0.01;
    });
    assert.equal(sameAngles, false);
  });
});

describe("orbitAngularSeparationDeg", () => {
  it("returns the smaller arc between two angles", () => {
    assert.equal(orbitAngularSeparationDeg(10, 190), 180);
    assert.equal(orbitAngularSeparationDeg(350, 10), 20);
  });
});
