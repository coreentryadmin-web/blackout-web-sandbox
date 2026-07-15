// Run: node --import tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/sources/vex-charm.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { baseInputs, TEST_NOW } from "../test-helpers";
import { etMinutesOfDay } from "./shared";
import {
  deriveVexCharmEvidence,
  CHARM_PIN_OPPOSE_WEIGHT,
  VEX_ALIGN_WEIGHT,
} from "./vex-charm";

// 2026-07-13 is EDT (UTC-4): 18:31Z = 14:31 ET (inside the charm window),
// 15:00Z = 11:00 ET (outside it).
const AFTERNOON = "2026-07-13T18:31:00.000Z";

describe("vex-charm: ET clock math", () => {
  test("etMinutesOfDay converts UTC to America/New_York minutes", () => {
    assert.equal(etMinutesOfDay(Date.parse(AFTERNOON)), 14 * 60 + 31);
    assert.equal(etMinutesOfDay(Date.parse(TEST_NOW)), 11 * 60);
  });
});

describe("vex-charm: VEX direction (small weight)", () => {
  test("negative net VEX aligns with a short, fights a long", () => {
    const vex = { asOf: TEST_NOW, netVex: -500_000_000, kingStrike: null };
    const short = deriveVexCharmEvidence(baseInputs({ direction: "short", vex }))[0];
    assert.equal(short.stance, "supports");
    assert.equal(short.weight, VEX_ALIGN_WEIGHT);
    assert.match(short.detail, /vol-up forces dealer selling/);

    const long = deriveVexCharmEvidence(baseInputs({ direction: "long", vex }))[0];
    assert.equal(long.stance, "opposes");
  });

  test("positive net VEX aligns with a long", () => {
    const vex = { asOf: TEST_NOW, netVex: 400_000_000, kingStrike: null };
    assert.equal(deriveVexCharmEvidence(baseInputs({ direction: "long", vex }))[0].stance, "supports");
  });

  test("null/zero VEX emits no direction item (absent, not fabricated)", () => {
    for (const netVex of [null, 0]) {
      const items = deriveVexCharmEvidence(baseInputs({ vex: { asOf: TEST_NOW, netVex, kingStrike: null } }));
      assert.equal(items.length, 1);
      assert.equal(items[0].stance, "absent");
    }
  });
});

describe("vex-charm: the charm pin heuristic (documented, no fabricated greeks)", () => {
  const pinned = {
    spot: 100.5,
    expectedMovePts: 4,
    vex: { asOf: AFTERNOON, netVex: null, kingStrike: 101 }, // 0.5 pts <= 0.3*4 = 1.2
  };

  test("after 14:30 ET inside 0.3x EM of the king node => oppose (both directions: premium buys)", () => {
    for (const direction of ["long", "short"] as const) {
      const input = baseInputs({ ...pinned, direction, now: AFTERNOON });
      const oppose = deriveVexCharmEvidence(input).find((i) => /pin-risk/.test(i.detail));
      assert.ok(oppose, direction);
      assert.equal(oppose.stance, "opposes");
      assert.equal(oppose.weight, CHARM_PIN_OPPOSE_WEIGHT);
      assert.match(oppose.detail, /heuristic until the real charm lens ships/);
    }
  });

  test("before 14:30 ET the heuristic stays silent", () => {
    const input = baseInputs({ ...pinned, now: TEST_NOW });
    assert.equal(deriveVexCharmEvidence(input).some((i) => /pin-risk/.test(i.detail)), false);
  });

  test("outside the pin radius the heuristic stays silent", () => {
    const input = baseInputs({
      ...pinned,
      now: AFTERNOON,
      vex: { asOf: AFTERNOON, netVex: null, kingStrike: 103 }, // 2.5 > 1.2
    });
    assert.equal(deriveVexCharmEvidence(input).some((i) => /pin-risk/.test(i.detail)), false);
  });

  test("no expected move / no king strike => no pin claim", () => {
    const noEm = baseInputs({ ...pinned, now: AFTERNOON, expectedMovePts: null });
    assert.equal(deriveVexCharmEvidence(noEm).some((i) => /pin-risk/.test(i.detail)), false);
  });
});

describe("vex-charm: honesty", () => {
  test("absent without the slice; error class surfaces", () => {
    assert.equal(deriveVexCharmEvidence(baseInputs())[0].stance, "absent");
    const failed = baseInputs({ errors: { "vex-charm": "RangeError" } });
    assert.match(deriveVexCharmEvidence(failed)[0].detail, /RangeError/);
  });
});
