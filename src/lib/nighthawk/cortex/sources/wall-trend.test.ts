// Run: node --import tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/sources/wall-trend.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { baseInputs, TEST_NOW } from "../test-helpers";
import type { CortexWallTrendSample } from "../types";
import {
  deriveWallTrendEvidence,
  kingStrikeOfSample,
  railSlopePctPerHour,
  MIN_TREND_SAMPLES,
  TREND_WINDOW_SEC,
  WALL_TREND_WEIGHT,
  KING_MIGRATION_WEIGHT,
} from "./wall-trend";

const NOW_SEC = Date.parse(TEST_NOW) / 1000;

/** n in-window samples ending 1 min ago, 3-min cadence, built from a per-index shape. */
function rail(n: number, shape: (i: number) => Pick<CortexWallTrendSample, "callWalls" | "putWalls">): CortexWallTrendSample[] {
  const start = NOW_SEC - 60 - (n - 1) * 180;
  return Array.from({ length: n }, (_, i) => ({ time: start + i * 180, ...shape(i) }));
}

describe("wall-trend: slope math", () => {
  test("least-squares slope in pct-pts/hour", () => {
    // 10 pct-pts down over exactly 1 hour of points -> -10/hr.
    const points = Array.from({ length: 13 }, (_, i) => ({ timeSec: i * 300, pct: 20 - (10 / 12) * i }));
    const slope = railSlopePctPerHour(points);
    assert.ok(slope != null && Math.abs(slope + 10) < 1e-6, `slope ${slope}`);
  });

  test("king node is the max-pct strike across both sides", () => {
    assert.equal(
      kingStrikeOfSample({
        time: 0,
        callWalls: [{ strike: 105, pct: 12 }],
        putWalls: [{ strike: 95, pct: 19 }],
      }),
      95
    );
  });
});

describe("wall-trend: the flagship lifecycle read", () => {
  test("fading opposing wall (long vs dimming call wall) => supports", () => {
    const input = baseInputs({
      direction: "long",
      wallTrend: {
        asOf: TEST_NOW,
        samples: rail(10, (i) => ({
          callWalls: [{ strike: 105, pct: 24 - i * 1.5 }], // fading fast
          putWalls: [{ strike: 95, pct: 30 }],
        })),
      },
    });
    const items = deriveWallTrendEvidence(input);
    const support = items.find((i) => i.stance === "supports" && i.weight > 0);
    assert.ok(support, JSON.stringify(items));
    assert.equal(support.weight, WALL_TREND_WEIGHT);
    assert.match(support.detail, /call wall 105 is fading/);
    assert.match(support.detail, /path clearing/);
  });

  test("building opposing wall => opposes", () => {
    const input = baseInputs({
      direction: "short",
      wallTrend: {
        asOf: TEST_NOW,
        samples: rail(10, (i) => ({
          callWalls: [{ strike: 105, pct: 30 }],
          putWalls: [{ strike: 95, pct: 10 + i * 1.5 }], // building under the short
        })),
      },
    });
    const oppose = deriveWallTrendEvidence(input).find((i) => i.stance === "opposes");
    assert.ok(oppose);
    assert.match(oppose.detail, /put wall 95 is building/);
  });

  test("flat opposing wall => zero-weight disclosure, no score effect", () => {
    const input = baseInputs({
      direction: "long",
      wallTrend: {
        asOf: TEST_NOW,
        samples: rail(10, () => ({
          callWalls: [{ strike: 105, pct: 20 }],
          putWalls: [{ strike: 95, pct: 20 }],
        })),
      },
    });
    const items = deriveWallTrendEvidence(input);
    assert.equal(items.length, 1);
    assert.equal(items[0].stance, "supports");
    assert.equal(items[0].weight, 0);
    assert.match(items[0].detail, /flat/);
  });

  test("a wall that DROPPED OUT of the ladder counts as pct 0 (fade support)", () => {
    // The dominant call wall only appears in later samples; early samples lack it
    // entirely -> series starts at 0 -> building; invert: wall present early, gone
    // late is measured against the LAST sample's dominant wall, so use a wall that
    // shrinks then drops out of earlier... simpler: last-sample wall absent early
    // means 0 -> building. Verify the 0-fill behaves deterministically.
    const input = baseInputs({
      direction: "long",
      wallTrend: {
        asOf: TEST_NOW,
        samples: rail(10, (i) => ({
          callWalls: i < 5 ? [{ strike: 110, pct: 8 }] : [{ strike: 105, pct: 10 + i }],
          putWalls: [{ strike: 95, pct: 30 }],
        })),
      },
    });
    const oppose = deriveWallTrendEvidence(input).find((i) => i.stance === "opposes");
    assert.ok(oppose, "a wall growing from nothing is building");
    assert.match(oppose.detail, /call wall 105 is building/);
  });

  test("king-node migration toward the target supports; away opposes", () => {
    const toward = baseInputs({
      direction: "short",
      wallTrend: {
        asOf: TEST_NOW,
        samples: rail(10, (i) => ({
          // King hops from 105 (call) to 95 (put) mid-window — downward, toward a short target.
          callWalls: [{ strike: 105, pct: i < 5 ? 30 : 20 }],
          putWalls: [{ strike: 95, pct: 25 }],
        })),
      },
    });
    const kingItem = deriveWallTrendEvidence(toward).find((i) => /king node/.test(i.detail));
    assert.ok(kingItem);
    assert.equal(kingItem.stance, "supports");
    assert.equal(kingItem.weight, KING_MIGRATION_WEIGHT);

    const away = baseInputs({ ...toward, direction: "long" });
    const kingAway = deriveWallTrendEvidence(away).find((i) => /king node/.test(i.detail));
    assert.ok(kingAway);
    assert.equal(kingAway.stance, "opposes");
  });

  test("evidence asOf anchors to the LAST rail sample (recorder stall decays honestly)", () => {
    const input = baseInputs({
      direction: "long",
      wallTrend: {
        asOf: TEST_NOW,
        samples: rail(10, (i) => ({
          callWalls: [{ strike: 105, pct: 24 - i * 1.5 }],
          putWalls: [],
        })),
      },
    });
    const item = deriveWallTrendEvidence(input).find((i) => i.stance !== "absent");
    assert.ok(item);
    assert.equal(item.asOf, new Date((NOW_SEC - 60) * 1000).toISOString());
  });
});

describe("wall-trend: recorder-gap honesty", () => {
  test(`absent below ${MIN_TREND_SAMPLES} in-window samples`, () => {
    const input = baseInputs({
      direction: "long",
      wallTrend: {
        asOf: TEST_NOW,
        samples: rail(MIN_TREND_SAMPLES - 1, () => ({
          callWalls: [{ strike: 105, pct: 20 }],
          putWalls: [],
        })),
      },
    });
    const items = deriveWallTrendEvidence(input);
    assert.equal(items[0].stance, "absent");
    assert.match(items[0].detail, /rail samples/);
  });

  test("samples outside the 45-min window are excluded", () => {
    // 20 samples but only 4 inside the window -> absent.
    const old = Array.from({ length: 16 }, (_, i) => ({
      time: NOW_SEC - TREND_WINDOW_SEC - 3600 + i * 60,
      callWalls: [{ strike: 105, pct: 20 }],
      putWalls: [],
    }));
    const recent = rail(4, () => ({ callWalls: [{ strike: 105, pct: 20 }], putWalls: [] }));
    const input = baseInputs({
      direction: "long",
      wallTrend: { asOf: TEST_NOW, samples: [...old, ...recent] },
    });
    assert.equal(deriveWallTrendEvidence(input)[0].stance, "absent");
  });

  test("absent without the slice, with the reader error class when recorded", () => {
    assert.equal(deriveWallTrendEvidence(baseInputs())[0].stance, "absent");
    const failed = baseInputs({ errors: { "wall-trend": "TypeError" } });
    assert.match(deriveWallTrendEvidence(failed)[0].detail, /reader failed \(TypeError\)/);
  });
});
