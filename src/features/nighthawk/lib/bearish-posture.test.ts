import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  detectBookPosture,
  applyBearishPosture,
  BEARISH_POSTURE_MIN_SIGNALS,
  BEARISH_RECAP_REASON,
} from "./bearish-posture";
import type { NightHawkRegimeContext, ScoredCandidate } from "./scorer";

function regime(overrides: Partial<NightHawkRegimeContext> = {}): NightHawkRegimeContext {
  return {
    vix_iv_rank: 50,
    tide_bias: "NEUTRAL",
    advance_pct: 50,
    composite_regime: null,
    anomaly_tickers: [],
    ...overrides,
  };
}

function scored(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    ticker: "AMD",
    score: 45,
    direction: "long",
    flow_score: 18,
    tech_score: 8,
    pos_score: 5,
    news_score: 0,
    smart_money_score: 6,
    conviction: "B",
    ...overrides,
  };
}

describe("detectBookPosture", () => {
  test("null regime → NEUTRAL", () => {
    assert.equal(detectBookPosture(null).posture, "NEUTRAL");
    assert.equal(detectBookPosture(undefined).posture, "NEUTRAL");
  });

  test("single bearish signal → NEUTRAL (not enough)", () => {
    const r = detectBookPosture(regime({ tide_bias: "BEARISH" }));
    assert.equal(r.posture, "NEUTRAL");
    assert.equal(r.reasons.length, 0);
  });

  test("tide BEARISH + breadth collapse → SHORT", () => {
    const r = detectBookPosture(regime({ tide_bias: "BEARISH", advance_pct: 30.5 }));
    assert.equal(r.posture, "SHORT");
    assert.equal(r.reasons.length, 2);
    assert.ok(r.reasons.some((s) => s.includes("put-dominated")));
    assert.ok(r.reasons.some((s) => s.includes("30.5%")));
  });

  test("tide BEARISH + composite bearish → SHORT", () => {
    const r = detectBookPosture(regime({ tide_bias: "BEARISH", composite_regime: "BEARISH" }));
    assert.equal(r.posture, "SHORT");
    assert.equal(r.reasons.length, 2);
  });

  test("breadth collapse + composite bearish (no tide) → SHORT", () => {
    const r = detectBookPosture(regime({ advance_pct: 25, composite_regime: "negative_gamma" }));
    assert.equal(r.posture, "SHORT");
    assert.equal(r.reasons.length, 2);
  });

  test("all three signals → SHORT with 3 reasons", () => {
    const r = detectBookPosture(regime({
      tide_bias: "BEARISH",
      advance_pct: 20,
      composite_regime: "BEARISH_EXTENDED",
    }));
    assert.equal(r.posture, "SHORT");
    assert.equal(r.reasons.length, 3);
  });

  test("bullish tape → NEUTRAL", () => {
    const r = detectBookPosture(regime({ tide_bias: "BULLISH", advance_pct: 70 }));
    assert.equal(r.posture, "NEUTRAL");
  });

  test("threshold constant is 2", () => {
    assert.equal(BEARISH_POSTURE_MIN_SIGNALS, 2);
  });
});

describe("applyBearishPosture", () => {
  test("NEUTRAL posture returns ranked unchanged", () => {
    const candidates = [scored({ ticker: "AMD", score: 50 }), scored({ ticker: "TSLA", score: 40 })];
    const result = applyBearishPosture(candidates, regime());
    assert.equal(result.posture, "NEUTRAL");
    assert.equal(result.flipped, 0);
    assert.deepEqual(result.ranked, candidates);
  });

  test("SHORT posture boosts existing short candidates", () => {
    const candidates = [
      scored({ ticker: "AMD", score: 45, direction: "long", flow_score: 18 }),
      scored({ ticker: "TSLA", score: 40, direction: "short" }),
    ];
    const bearish = regime({ tide_bias: "BEARISH", advance_pct: 25 });
    const result = applyBearishPosture(candidates, bearish);

    assert.equal(result.posture, "SHORT");
    // TSLA (short) should now rank above AMD (long) after boost/penalty
    assert.equal(result.ranked[0].ticker, "TSLA");
    assert.equal(result.ranked[0].score, 48); // 40 + 8 bonus
    assert.equal(result.ranked[1].ticker, "AMD");
    assert.equal(result.ranked[1].score, 39); // 45 - 6 penalty
  });

  test("thin-flow long candidates get flipped to short", () => {
    const candidates = [
      scored({ ticker: "AMD", score: 45, direction: "long", flow_score: 8 }),
    ];
    const bearish = regime({ tide_bias: "BEARISH", advance_pct: 25 });
    const result = applyBearishPosture(candidates, bearish);

    assert.equal(result.flipped, 1);
    assert.equal(result.ranked[0].direction, "short");
    assert.equal(result.ranked[0].score, 47); // 45 + 8 - 6
  });

  test("strong-flow long candidates are penalized but not flipped", () => {
    const candidates = [
      scored({ ticker: "AMD", score: 50, direction: "long", flow_score: 25 }),
    ];
    const bearish = regime({ tide_bias: "BEARISH", advance_pct: 25 });
    const result = applyBearishPosture(candidates, bearish);

    assert.equal(result.flipped, 0);
    assert.equal(result.ranked[0].direction, "long");
    assert.equal(result.ranked[0].score, 44); // 50 - 6
  });

  test("mixed batch: shorts surface, thin-flow longs flip, strong longs demote", () => {
    const candidates = [
      scored({ ticker: "AMD", score: 55, direction: "long", flow_score: 25 }), // strong long
      scored({ ticker: "TSLA", score: 42, direction: "short" }),                // existing short
      scored({ ticker: "WFC", score: 40, direction: "long", flow_score: 5 }),   // thin long → flip
    ];
    const bearish = regime({ tide_bias: "BEARISH", advance_pct: 30, composite_regime: "BEARISH" });
    const result = applyBearishPosture(candidates, bearish);

    assert.equal(result.posture, "SHORT");
    assert.equal(result.flipped, 1);
    // TSLA 42+8=50, AMD 55-6=49, WFC 40+8-6=42
    assert.equal(result.ranked[0].ticker, "TSLA");
    assert.equal(result.ranked[0].score, 50);
    assert.equal(result.ranked[1].ticker, "AMD");
    assert.equal(result.ranked[1].score, 49);
    assert.equal(result.ranked[2].ticker, "WFC");
    assert.equal(result.ranked[2].direction, "short");
    assert.equal(result.ranked[2].score, 42);
  });

  test("does not mutate input array", () => {
    const original = [scored({ ticker: "AMD", score: 45, direction: "short" })];
    const bearish = regime({ tide_bias: "BEARISH", advance_pct: 25 });
    const result = applyBearishPosture(original, bearish);
    assert.equal(original[0].score, 45);
    assert.notEqual(result.ranked[0], original[0]);
  });

  test("score floor at 0 (penalty never goes negative)", () => {
    const candidates = [scored({ ticker: "AMD", score: 3, direction: "long", flow_score: 25 })];
    const bearish = regime({ tide_bias: "BEARISH", advance_pct: 25 });
    const result = applyBearishPosture(candidates, bearish);
    assert.equal(result.ranked[0].score, 0);
  });

  test("BEARISH_RECAP_REASON is the expected string", () => {
    assert.ok(BEARISH_RECAP_REASON.includes("no aligned SHORT setups"));
  });
});
