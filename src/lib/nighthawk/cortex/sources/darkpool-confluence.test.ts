// Run: node --import tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/sources/darkpool-confluence.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { baseInputs, TEST_NOW } from "../test-helpers";
import type { CortexInputs } from "../types";
import { deriveDarkPoolConfluenceEvidence, DARKPOOL_BONUS_WEIGHT, DARKPOOL_MIN_PREMIUM } from "./darkpool-confluence";

/** A long with a supporting put wall at 99.2 (0.8 pts behind, <= 0.25x EM = 1). */
function withSupportingWall(over: Partial<CortexInputs> = {}): CortexInputs {
  return baseInputs({
    direction: "long",
    spot: 100,
    expectedMovePts: 4,
    gex: {
      asOf: TEST_NOW,
      spot: 100,
      callWalls: [{ strike: 110, pct: 10 }],
      putWalls: [{ strike: 99.2, pct: 15 }],
      gammaFlip: null,
      regimePosture: "short",
    },
    ...over,
  });
}

describe("darkpool-confluence: the bonus (never standalone)", () => {
  test("sized level within 0.1x EM of the supporting wall => support", () => {
    const input = withSupportingWall({
      darkPool: { asOf: TEST_NOW, levels: [{ price: 99.5, premium: 20_000_000 }] }, // 0.3 <= 0.4
    });
    const item = deriveDarkPoolConfluenceEvidence(input)[0];
    assert.equal(item.stance, "supports");
    assert.equal(item.weight, DARKPOOL_BONUS_WEIGHT);
    assert.match(item.detail, /99\.5/);
    assert.match(item.detail, /\$20M/);
  });

  test("no supporting wall => absent even with a perfect level (bonus-only rule)", () => {
    const input = baseInputs({
      direction: "long",
      spot: 100,
      expectedMovePts: 4,
      gex: {
        asOf: TEST_NOW,
        spot: 100,
        callWalls: [{ strike: 101, pct: 20 }], // a BLOCKING wall, not a supporting one
        putWalls: [],
        gammaFlip: null,
        regimePosture: "short",
      },
      darkPool: { asOf: TEST_NOW, levels: [{ price: 101.1, premium: 50_000_000 }] },
    });
    const item = deriveDarkPoolConfluenceEvidence(input)[0];
    assert.equal(item.stance, "absent");
    assert.match(item.detail, /bonus-only/);
  });

  test("a level beyond 0.1x EM of the wall is not confluence", () => {
    const input = withSupportingWall({
      darkPool: { asOf: TEST_NOW, levels: [{ price: 98.5, premium: 20_000_000 }] }, // 0.7 > 0.4
    });
    assert.equal(deriveDarkPoolConfluenceEvidence(input)[0].stance, "absent");
  });

  test("levels without size context are decoration (premium floor)", () => {
    const input = withSupportingWall({
      darkPool: { asOf: TEST_NOW, levels: [{ price: 99.3, premium: DARKPOOL_MIN_PREMIUM - 1 }] },
    });
    assert.equal(deriveDarkPoolConfluenceEvidence(input)[0].stance, "absent");
  });

  test("deterministic pick: nearest level first, larger premium on ties", () => {
    const input = withSupportingWall({
      darkPool: {
        asOf: TEST_NOW,
        levels: [
          { price: 99.5, premium: 8_000_000 },
          { price: 99.3, premium: 6_000_000 }, // nearer wins despite smaller size
        ],
      },
    });
    assert.match(deriveDarkPoolConfluenceEvidence(input)[0].detail, /99\.3/);
  });
});

describe("darkpool-confluence: honesty", () => {
  test("absent without the slice / without an expected move; error class surfaces", () => {
    assert.equal(deriveDarkPoolConfluenceEvidence(baseInputs())[0].stance, "absent");
    const noEm = withSupportingWall({
      expectedMovePts: null,
      darkPool: { asOf: TEST_NOW, levels: [{ price: 99.3, premium: 20_000_000 }] },
    });
    assert.equal(deriveDarkPoolConfluenceEvidence(noEm)[0].stance, "absent");
    const failed = baseInputs({ errors: { "darkpool-confluence": "CortexSourceTimeout" } });
    assert.match(deriveDarkPoolConfluenceEvidence(failed)[0].detail, /CortexSourceTimeout/);
  });
});
