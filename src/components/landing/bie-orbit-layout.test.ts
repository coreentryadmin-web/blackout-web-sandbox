import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrbitTool } from "./BieOrbitTools";
import { buildRandomOrbitLayout, mulberry32, wanderOrbitDeg } from "./bie-orbit-layout";

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

describe("wanderOrbitDeg", () => {
  it("nudges angle within a bounded range", () => {
    const rand = mulberry32(7);
    const next = wanderOrbitDeg(120, rand);
    assert.ok(next >= 0 && next < 360);
    assert.notEqual(next, 120);
  });
});
