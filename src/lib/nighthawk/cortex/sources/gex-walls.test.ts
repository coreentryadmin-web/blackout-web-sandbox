// Run: node --import tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/sources/gex-walls.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { baseInputs, TEST_NOW } from "../test-helpers";
import type { CortexGexSlice } from "../types";
import {
  deriveGexWallsEvidence,
  wallPathCheck,
  WALL_ENTRY_SUPPORT_EM_FRAC,
  WALL_PATH_BLOCK_EM_FRAC,
  GEX_WALLS_SUPPORT_WEIGHT,
  REGIME_STYLE_OPPOSE_WEIGHT,
} from "./gex-walls";

function gex(over: Partial<CortexGexSlice> = {}): CortexGexSlice {
  return {
    asOf: TEST_NOW,
    spot: 100,
    callWalls: [],
    putWalls: [],
    gammaFlip: null,
    regimePosture: "short",
    ...over,
  };
}

describe("gex-walls: wallPathCheck geometry", () => {
  test("long veto when the dominant call wall sits inside 0.5x EM of the path", () => {
    const input = baseInputs({
      direction: "long",
      spot: 100,
      expectedMovePts: 4,
      gex: gex({ callWalls: [{ strike: 101.5, pct: 20 }] }), // 1.5 <= 0.5*4
    });
    const items = deriveGexWallsEvidence(input);
    assert.equal(items.filter((i) => i.stance === "veto").length, 1);
    assert.match(items[0].detail, /call wall 101\.5/);
  });

  test("no veto when the opposing wall is beyond 0.5x EM", () => {
    const input = baseInputs({
      direction: "long",
      spot: 100,
      expectedMovePts: 4,
      gex: gex({ callWalls: [{ strike: 102.5, pct: 20 }] }), // 2.5 > 2
    });
    assert.equal(deriveGexWallsEvidence(input).some((i) => i.stance === "veto"), false);
  });

  test("only the DOMINANT opposing wall (rank [0]) can veto", () => {
    // The strongest call wall is far away; a weaker node inside the radius must not block.
    const input = baseInputs({
      direction: "long",
      spot: 100,
      expectedMovePts: 4,
      gex: gex({
        callWalls: [
          { strike: 105, pct: 25 },
          { strike: 101, pct: 5 },
        ],
      }),
    });
    assert.equal(deriveGexWallsEvidence(input).some((i) => i.stance === "veto"), false);
  });

  test("long support when a put wall sits <=0.25x EM behind entry", () => {
    const input = baseInputs({
      direction: "long",
      spot: 100,
      expectedMovePts: 4,
      gex: gex({ putWalls: [{ strike: 99.2, pct: 15 }] }), // 0.8 <= 0.25*4 = 1
    });
    const supports = deriveGexWallsEvidence(input).filter((i) => i.stance === "supports" && i.weight > 0);
    assert.equal(supports.length, 1);
    assert.equal(supports[0].weight, GEX_WALLS_SUPPORT_WEIGHT);
    assert.match(supports[0].detail, /put wall 99\.2/);
  });

  test("no support when the same-side wall is farther than 0.25x EM", () => {
    const input = baseInputs({
      direction: "long",
      spot: 100,
      expectedMovePts: 4,
      gex: gex({ putWalls: [{ strike: 98.5, pct: 15 }] }), // 1.5 > 1
    });
    assert.equal(
      deriveGexWallsEvidence(input).some((i) => i.stance === "supports" && i.weight > 0),
      false
    );
  });

  test("short direction mirrors: put wall below blocks, call wall above supports", () => {
    const input = baseInputs({
      direction: "short",
      spot: 100,
      expectedMovePts: 4,
      gex: gex({
        putWalls: [{ strike: 98.5, pct: 22 }], // 1.5 below, inside 2 -> veto
        callWalls: [{ strike: 100.6, pct: 18 }], // 0.6 above, inside 1 -> support
      }),
    });
    const { blockingWall, supportingWall } = wallPathCheck(input);
    assert.equal(blockingWall?.strike, 98.5);
    assert.equal(supportingWall?.strike, 100.6);
    const items = deriveGexWallsEvidence(input);
    assert.equal(items.filter((i) => i.stance === "veto").length, 1);
    assert.equal(items.filter((i) => i.stance === "supports" && i.weight > 0).length, 1);
  });

  test("thresholds are the design-doc constants", () => {
    assert.equal(WALL_PATH_BLOCK_EM_FRAC, 0.5);
    assert.equal(WALL_ENTRY_SUPPORT_EM_FRAC, 0.25);
  });
});

describe("gex-walls: regime-style match", () => {
  test("long-gamma tape opposes a momentum commit (oppose, not veto)", () => {
    const input = baseInputs({
      direction: "long",
      spot: 100,
      expectedMovePts: 4,
      gex: gex({ regimePosture: "long", gammaFlip: 98, callWalls: [{ strike: 105, pct: 10 }] }),
    });
    const opposes = deriveGexWallsEvidence(input).filter((i) => i.stance === "opposes");
    assert.equal(opposes.length, 1);
    assert.equal(opposes[0].weight, REGIME_STYLE_OPPOSE_WEIGHT);
    assert.match(opposes[0].detail, /long-gamma/);
  });

  test("short-gamma (trending) tape emits no regime opposition", () => {
    const input = baseInputs({
      direction: "short",
      spot: 100,
      expectedMovePts: 4,
      gex: gex({ regimePosture: "short", putWalls: [{ strike: 90, pct: 10 }] }),
    });
    assert.equal(deriveGexWallsEvidence(input).some((i) => i.stance === "opposes"), false);
  });
});

describe("gex-walls: honesty (absent, never fabricated)", () => {
  test("absent without the slice / spot / expected move / wall nodes", () => {
    for (const input of [
      baseInputs(),
      baseInputs({ gex: gex(), spot: null, expectedMovePts: 4 }),
      baseInputs({ gex: gex(), spot: 100, expectedMovePts: null }),
      baseInputs({ gex: gex(), spot: 100, expectedMovePts: 4 }), // empty ladder
    ]) {
      const items = deriveGexWallsEvidence(input);
      assert.equal(items.length, 1);
      assert.equal(items[0].stance, "absent");
      assert.equal(items[0].weight, 0);
    }
  });

  test("a failed reader surfaces its error class in the absent reason", () => {
    const input = baseInputs({ errors: { "gex-walls": "CortexSourceTimeout" } });
    assert.match(deriveGexWallsEvidence(input)[0].detail, /reader failed \(CortexSourceTimeout\)/);
  });

  test("a neutral geometry still discloses that the check ran (zero-weight support)", () => {
    const input = baseInputs({
      direction: "long",
      spot: 100,
      expectedMovePts: 4,
      gex: gex({ regimePosture: "short", callWalls: [{ strike: 110, pct: 10 }] }),
    });
    const items = deriveGexWallsEvidence(input);
    assert.equal(items.length, 1);
    assert.equal(items[0].stance, "supports");
    assert.equal(items[0].weight, 0);
  });
});
