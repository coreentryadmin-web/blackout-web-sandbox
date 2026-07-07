import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrbitTool } from "./BieOrbitTools";
import {
  ORBIT_OSCILLATION_AMPLITUDE_DEG,
  TOOL_ORBIT_RINGS,
  TOOL_RING_ANCHOR_DEG,
  buildOrbitLayout,
  orbitAngularSeparationDeg,
} from "./bie-orbit-layout";

const TOOLS: OrbitTool[] = [
  { name: "A", href: "/a", mark: "spx", accent: "#0f0" },
  { name: "B", href: "/b", mark: "helix", accent: "#00f" },
  { name: "C", href: "/c", mark: "heatmap", accent: "#f00" },
  { name: "D", href: "/d", mark: "vector", accent: "#ff0" },
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

  it("gives every tool the shared oscillation amplitude", () => {
    const layout = buildOrbitLayout(TOOLS, SCALES, 42);
    for (const tool of layout) {
      assert.equal(tool.oscillationAmplitudeDeg, ORBIT_OSCILLATION_AMPLITUDE_DEG);
    }
  });
});

describe("adjacent-ring anchors can never swing into collision", () => {
  it("every adjacent ring pair's anchor separation exceeds 2x the oscillation amplitude, with margin", () => {
    // Two tools on rings that are numerically adjacent (1&2, 2&3, ... 6&1) sit
    // in near-identical radius bands (see bie-helix-engine's fieldLineWarp),
    // so they're the pairs that CAN visually collide if their swings ever
    // bring them to the same angle. Non-adjacent rings (e.g. 1&5) have such
    // different radii that angular closeness alone can't cause a collision,
    // so they're not checked here. A safety margin beyond the bare minimum
    // (2x amplitude) covers each icon's own visual footprint (~52px mark +
    // label), not just its center point.
    const SAFETY_MARGIN_DEG = 20;
    const minRequired = 2 * ORBIT_OSCILLATION_AMPLITUDE_DEG + SAFETY_MARGIN_DEG;

    for (let i = 0; i < TOOL_ORBIT_RINGS.length; i++) {
      const ringA = TOOL_ORBIT_RINGS[i];
      const ringB = TOOL_ORBIT_RINGS[(i + 1) % TOOL_ORBIT_RINGS.length];
      const gap = orbitAngularSeparationDeg(TOOL_RING_ANCHOR_DEG[ringA], TOOL_RING_ANCHOR_DEG[ringB]);
      assert.ok(
        gap >= minRequired,
        `ring ${ringA} <-> ring ${ringB}: anchor gap ${gap}deg is under the ${minRequired}deg required to guarantee no collision`
      );
    }
  });
});

describe("orbitAngularSeparationDeg", () => {
  it("returns the smaller arc between two angles", () => {
    assert.equal(orbitAngularSeparationDeg(10, 190), 180);
    assert.equal(orbitAngularSeparationDeg(350, 10), 20);
  });
});
