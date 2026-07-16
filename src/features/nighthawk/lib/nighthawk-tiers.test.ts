import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  assignNighthawkTier,
  nhTierInputFromScored,
  nhConvictionRank,
  nhDisplayTierFor,
  NH_SCORE_PRIME_MIN,
  NH_SCORE_PRIME_MAX,
  NH_SCORE_TOP_MIN,
  NH_TIER_APLUS_UNLOCK,
} from "./nighthawk-tiers";

// ── assignNighthawkTier ─────────────────────────────────────────────────────────

describe("assignNighthawkTier", () => {
  test("prime-band score + strong signals → A", () => {
    const result = assignNighthawkTier({
      score: 48,
      confirmingSignals: 4,
      earningsRisk: false,
    });
    assert.equal(result.tier, "A");
    assert.ok(result.factors.some((f) => f.label === "Prime score band"));
    assert.ok(result.factors.some((f) => f.label === "Strong signal breadth"));
  });

  test("prime-band score + adequate signals → A", () => {
    const result = assignNighthawkTier({
      score: 45,
      confirmingSignals: 2,
      earningsRisk: false,
    });
    assert.equal(result.tier, "A");
  });

  test("mid-band score + strong signals → A", () => {
    const result = assignNighthawkTier({
      score: 60,
      confirmingSignals: 3,
      earningsRisk: false,
    });
    assert.equal(result.tier, "A");
  });

  test("top-band score (≥70) is capped at B despite strong signals", () => {
    const result = assignNighthawkTier({
      score: 80,
      confirmingSignals: 5,
      earningsRisk: false,
    });
    assert.equal(result.tier, "B");
    assert.ok(result.factors.some((f) => f.label === "Score 70+ tier cap"));
  });

  test("mid-band score + thin signals → B (capped)", () => {
    const result = assignNighthawkTier({
      score: 60,
      confirmingSignals: 1,
      earningsRisk: false,
    });
    assert.equal(result.tier, "B");
    assert.ok(result.factors.some((f) => f.label === "Thin signals"));
  });

  test("prime-band + strong signals + earnings risk → B (risk caps)", () => {
    const result = assignNighthawkTier({
      score: 48,
      confirmingSignals: 4,
      earningsRisk: true,
    });
    assert.equal(result.tier, "B");
    assert.ok(result.factors.some((f) => f.label === "Earnings risk"));
  });

  test("below-floor score → C", () => {
    const result = assignNighthawkTier({
      score: 30,
      confirmingSignals: 3,
      earningsRisk: false,
    });
    assert.equal(result.tier, "C");
    assert.ok(result.factors.some((f) => f.label === "Score below floor"));
  });

  test("null score → C (evidence gap)", () => {
    const result = assignNighthawkTier({
      score: null,
      confirmingSignals: 5,
      earningsRisk: false,
    });
    assert.equal(result.tier, "C");
    assert.ok(result.factors.some((f) => f.label === "Score missing"));
  });

  test("null confirming signals caps at B", () => {
    const result = assignNighthawkTier({
      score: 48,
      confirmingSignals: null,
      earningsRisk: false,
    });
    assert.equal(result.tier, "B");
    assert.ok(result.factors.some((f) => f.label === "Signal count missing"));
  });

  test("mid-band + adequate signals → B", () => {
    const result = assignNighthawkTier({
      score: 60,
      confirmingSignals: 2,
      earningsRisk: false,
    });
    assert.equal(result.tier, "B");
  });

  test("boundary: score exactly at prime min (40) → prime band", () => {
    const result = assignNighthawkTier({
      score: NH_SCORE_PRIME_MIN,
      confirmingSignals: 3,
      earningsRisk: false,
    });
    assert.equal(result.tier, "A");
    assert.ok(result.factors.some((f) => f.label === "Prime score band"));
  });

  test("boundary: score exactly at prime max (55) → mid band", () => {
    const result = assignNighthawkTier({
      score: NH_SCORE_PRIME_MAX,
      confirmingSignals: 3,
      earningsRisk: false,
    });
    assert.equal(result.tier, "A");
    assert.ok(result.factors.some((f) => f.label === "Mid score band"));
  });

  test("boundary: score exactly at top min (70) → top band, capped B", () => {
    const result = assignNighthawkTier({
      score: NH_SCORE_TOP_MIN,
      confirmingSignals: 5,
      earningsRisk: false,
    });
    assert.equal(result.tier, "B");
  });

  test("factors are populated for every input", () => {
    const result = assignNighthawkTier({
      score: 50,
      confirmingSignals: 3,
      earningsRisk: true,
    });
    assert.ok(result.factors.length >= 3);
    assert.ok(result.factors.every((f) => f.label && f.direction && f.detail));
  });
});

// ── nhTierInputFromScored ───────────────────────────────────────────────────────

describe("nhTierInputFromScored", () => {
  test("maps ScoredCandidate fields to tier input", () => {
    const input = nhTierInputFromScored({
      score: 55,
      confirming_signals: 3,
      earnings_risk: true,
    });
    assert.equal(input.score, 55);
    assert.equal(input.confirmingSignals, 3);
    assert.equal(input.earningsRisk, true);
  });

  test("defaults missing fields", () => {
    const input = nhTierInputFromScored({ score: 40 });
    assert.equal(input.confirmingSignals, null);
    assert.equal(input.earningsRisk, false);
  });
});

// ── nhConvictionRank ────────────────────────────────────────────────────────────

describe("nhConvictionRank", () => {
  test("orders A+ > A > B > C", () => {
    assert.ok(nhConvictionRank("A+") > nhConvictionRank("A"));
    assert.ok(nhConvictionRank("A") > nhConvictionRank("B"));
    assert.ok(nhConvictionRank("B") > nhConvictionRank("C"));
  });

  test("unknown letters default to B rank", () => {
    assert.equal(nhConvictionRank("weird"), nhConvictionRank("B"));
  });

  test("case insensitive", () => {
    assert.equal(nhConvictionRank("a+"), nhConvictionRank("A+"));
    assert.equal(nhConvictionRank("b"), nhConvictionRank("B"));
  });
});

// ── nhDisplayTierFor ────────────────────────────────────────────────────────────

describe("nhDisplayTierFor", () => {
  test("A + unlocked → A+", () => {
    assert.equal(nhDisplayTierFor("A", true), "A+");
  });

  test("A + locked → A", () => {
    assert.equal(nhDisplayTierFor("A", false), "A");
  });

  test("B + unlocked → B (only A can promote)", () => {
    assert.equal(nhDisplayTierFor("B", true), "B");
  });

  test("C + unlocked → C", () => {
    assert.equal(nhDisplayTierFor("C", true), "C");
  });
});

// ── measured inversion guard (the WHY of this engine) ───────────────────────────

describe("overnight inversion guard", () => {
  test("old A+ range (score 70+) can never get A — inversion is built in", () => {
    for (const score of [70, 75, 80, 85, 90, 95, 100]) {
      const result = assignNighthawkTier({
        score,
        confirmingSignals: 5,
        earningsRisk: false,
      });
      assert.notEqual(result.tier, "A", `score ${score} must not earn A`);
    }
  });

  test("old B range (score 40-54) CAN earn A with strong signals", () => {
    const result = assignNighthawkTier({
      score: 48,
      confirmingSignals: 3,
      earningsRisk: false,
    });
    assert.equal(result.tier, "A");
  });
});
