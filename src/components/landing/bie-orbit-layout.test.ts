import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrbitTool } from "./BieOrbitTools";
import {
  TOOL_RING_ANCHOR_DEG,
  buildOrbitLayout,
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

const SCALES = {
  1: 0.22,
  2: 0.34,
  3: 0.52,
  4: 0.72,
  5: 0.88,
  6: 1,
} as const;

describe("buildOrbitLayout", () => {
  it("places one tool on each ring from 1 through 6", () => {
    const layout = buildOrbitLayout(TOOLS, SCALES, 42);
    assert.equal(layout.length, 6);
    for (const ring of [1, 2, 3, 4, 5, 6] as const) {
      assert.equal(layout.filter((t) => t.orbitRing === ring).length, 1);
    }
  });

  it("uses fixed compass anchors per ring", () => {
    const layout = buildOrbitLayout(TOOLS, SCALES, 42);
    for (const tool of layout) {
      assert.equal(tool.startAngleDeg, TOOL_RING_ANCHOR_DEG[tool.orbitRing]);
    }
  });

  it("maps tools in array order to rings 1–6", () => {
    const layout = buildOrbitLayout(TOOLS, SCALES, 42);
    assert.deepEqual(
      layout.map((t) => [t.orbitRing, t.name]),
      [
        [1, "A"],
        [2, "B"],
        [3, "C"],
        [4, "D"],
        [5, "E"],
        [6, "F"],
      ]
    );
  });

  it("keeps anchors fixed while orbit period jitters per seed", () => {
    const a = buildOrbitLayout(TOOLS, SCALES, 99);
    const b = buildOrbitLayout(TOOLS, SCALES, 100);
    assert.deepEqual(
      a.map((t) => t.startAngleDeg),
      b.map((t) => t.startAngleDeg)
    );
    assert.notEqual(a[0].orbitPeriodSec, b[0].orbitPeriodSec);
  });
});

describe("orbitAngularSeparationDeg", () => {
  it("returns the smaller arc between two angles", () => {
    assert.equal(orbitAngularSeparationDeg(10, 190), 180);
    assert.equal(orbitAngularSeparationDeg(350, 10), 20);
  });
});
