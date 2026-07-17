import assert from "node:assert/strict";
import test from "node:test";
import {
  scoreNewsCatalyst,
  scoreSmartMoney,
  scoreOptionsPositioning,
  scoreTechnicalSetup,
  scoreSkewConfirmation,
  scoreFlowQuality,
  scoreCandidate,
  scoreWallProximity,
  scoreVexAlignment,
  computeRegimeMultiplier,
  rankingScore,
  rankCandidates,
} from "./scorer";
import type { ScoredCandidate } from "./scorer";
import type { PositioningSummary } from "./positioning";
import type { TechnicalCard } from "./technicals";

// Direction-correctness regression suite (2026-07-02 audit): several factors scored
// BULLISH evidence as a bonus for SHORT plays. Each test pins the mirrored behavior.

// ── scoreNewsCatalyst ────────────────────────────────────────────────────────────

const bullishNews = {
  news_headlines: [
    "positive: Analyst upgrade at MegaBank",
    "positive: Q2 earnings beat expectations",
    "neutral: sector roundup",
  ],
  insider_buys: 2,
};

test("news: bullish headlines + insider buys HELP a long", () => {
  assert.ok(scoreNewsCatalyst(bullishNews, "long") > 0);
});

test("news: the same bullish headlines HURT a short (old code added them)", () => {
  assert.ok(scoreNewsCatalyst(bullishNews, "short") < 0);
});

test("news: bearish headlines SUPPORT a short", () => {
  const bearish = {
    news_headlines: [
      "negative: downgrade to underweight",
      "negative: DOJ investigation widens",
      "negative: guidance miss",
    ],
  };
  assert.ok(scoreNewsCatalyst(bearish, "short") > 0);
  assert.ok(scoreNewsCatalyst(bearish, "long") < 0);
});

test("news: buyback keyword no longer scores here (triple-count dedupe)", () => {
  const buyback = { news_headlines: ["neutral: board authorizes $2B buyback"] };
  // One headline, balanced sentiment, no keyword hit → 0 either way.
  assert.equal(scoreNewsCatalyst(buyback, "long"), 0);
});

// ── scoreSmartMoney ──────────────────────────────────────────────────────────────

const buyingInstitutions = [
  { action: "buy", change: 500_000 },
  { action: "added", change: 250_000 },
];

test("smart money: institutional net BUYING helps a long, penalizes a short", () => {
  const long = scoreSmartMoney({ institutional_activity: buyingInstitutions }, "long");
  const short = scoreSmartMoney({ institutional_activity: buyingInstitutions }, "short");
  assert.equal(long, 3);
  assert.equal(short, -2);
});

test("smart money: congress BUYS score longs, not shorts", () => {
  const fresh = new Date().toISOString();
  const rows = [
    { txn_type: "Buy", filed_at: fresh },
    { txn_type: "Buy", filed_at: fresh },
    { txn_type: "Buy", filed_at: fresh },
  ];
  const long = scoreSmartMoney({ congress_unusual: rows }, "long");
  const short = scoreSmartMoney({ congress_unusual: rows }, "short");
  assert.equal(long, 3); // 3 fresh aligned buys, capped at 3
  assert.equal(short, 0); // buys don't back a short
});

test("smart money: congress SELLS back a short, not a long", () => {
  const fresh = new Date().toISOString();
  const rows = [{ txn_type: "Sell", filed_at: fresh }, { txn_type: "Sale (full)", filed_at: fresh }];
  assert.ok(scoreSmartMoney({ congress_unusual: rows }, "short") > 0);
  assert.equal(scoreSmartMoney({ congress_unusual: rows }, "long"), 0);
});

test("smart money: unknown congress side counts at half weight", () => {
  const fresh = new Date().toISOString();
  const rows = [{ filed_at: fresh }, { filed_at: fresh }]; // no txn_type
  assert.equal(scoreSmartMoney({ congress_unusual: rows }, "long"), 1);
});

// ── scoreOptionsPositioning ──────────────────────────────────────────────────────

function stack(option_type: string, overrides: Record<string, unknown> = {}) {
  return {
    ticker: "TEST",
    strike: 100,
    option_type,
    expiry: "2026-08-21",
    alert_count: 4,
    total_premium: 2_000_000,
    premiums: [500_000],
    trade_count: 4,
    repeated_hits: true,
    same_strike_accumulation: true,
    alert_rules: [],
    kind: "repeated_and_stacked" as const,
    ...overrides,
  };
}

test("positioning: dark pool with CONTRADICTING bias scores zero (was half)", () => {
  const contra = scoreOptionsPositioning(
    { dark_pool: { total_premium: 60_000_000, bias: "bearish" } },
    "long"
  );
  assert.equal(contra, 0);
});

test("positioning: dark pool with UNKNOWN bias scores half (was full)", () => {
  const unknown = scoreOptionsPositioning(
    { dark_pool: { total_premium: 60_000_000, bias: "mixed" } },
    "long"
  );
  assert.equal(unknown, 3); // 6 * 0.5
  const aligned = scoreOptionsPositioning(
    { dark_pool: { total_premium: 60_000_000, bias: "bullish" } },
    "long"
  );
  assert.equal(aligned, 6);
});

test("positioning: PUT strike stacks no longer score a LONG", () => {
  const putStacks = scoreOptionsPositioning({ strike_stacks: [stack("put")] }, "long");
  assert.equal(putStacks, 0);
  const callStacks = scoreOptionsPositioning({ strike_stacks: [stack("call")] }, "long");
  assert.equal(callStacks, 7); // repeated_hits 4 + same_strike 3
  // And the mirror: put stacks DO back a short.
  assert.equal(scoreOptionsPositioning({ strike_stacks: [stack("put")] }, "short"), 7);
});

test("positioning: presence-as-signal points removed (net_vex/max_pain/oi-count)", () => {
  const presenceOnly = scoreOptionsPositioning(
    {
      positioning: { negative_gamma: false, net_vex: 123456, max_pain: 100 } as never,
      oi_change: [{ oi_change: -5, option_type: "call" }, { oi_change: -2, option_type: "put" }, { oi_change: 0, option_type: "call" }],
    },
    "long"
  );
  assert.equal(presenceOnly, 0);
});

test("positioning: OI growth only counts when aligned with direction", () => {
  const callGrowth = [
    { oi_change: 1200, option_type: "call" },
    { oi_change: 800, option_type: "call" },
  ];
  assert.equal(scoreOptionsPositioning({ oi_change: callGrowth }, "long"), 2);
  assert.equal(scoreOptionsPositioning({ oi_change: callGrowth }, "short"), 0);
});

// ── scoreTechnicalSetup (short branch) ───────────────────────────────────────────

function tech(overrides: Partial<TechnicalCard>): TechnicalCard {
  return {
    trend: "neutral",
    setup_tags: [],
    rsi14: null,
    rel_volume: null,
    ...overrides,
  } as TechnicalCard;
}

test("tech short: gap-UP tag ('gap-fill risk below') no longer scores a short", () => {
  // technicals.ts emits "gap-fill risk below" for a gap UP — the old substring match
  // on "below" handed +5 to a short on a gapped-UP name.
  const gapUp = tech({ setup_tags: ["gap up 1.20", "gap-fill risk below"] });
  assert.equal(scoreTechnicalSetup(gapUp, "short"), 0);
  const gapDown = tech({ setup_tags: ["gap down 1.20", "gap-fill bounce zone above"] });
  assert.equal(scoreTechnicalSetup(gapDown, "short"), 5);
});

test("tech short: fresh-highs structure now penalizes a short (mirror of long's +6)", () => {
  const breakout = tech({ setup_tags: ["20d range breakout", "prior day HOD break"] });
  assert.equal(scoreTechnicalSetup(breakout, "short"), -6);
});

test("tech short: bearish MA stack now rewards a short (mirror of long's bullish-ma +4)", () => {
  const bearishMa = tech({ setup_tags: ["bearish MA stack"], trend: "bearish" });
  assert.equal(scoreTechnicalSetup(bearishMa, "short"), 12); // trend 8 + ma 4
});

// ── scoreSkewConfirmation + scoreFlowQuality's skew-based direction flip ─────────
//
// fix/nighthawk-skew-sign-flip (2026-07-04 audit, task #125): UW's `risk_reversal` field
// (dossierExtras.risk_reversal_skew) is (put IV − call IV), NOT (call IV − put IV) —
// confirmed via a LIVE pull of `GET /api/stock/SPY/historical-risk-reversal-skew` that
// returned 29 daily rows, EVERY ONE positive (+0.0067 to +0.0663, e.g.
// `{"date":"2026-07-02","risk_reversal":"0.0663361729210146"}`). A "call IV minus put IV"
// definition would be predominantly NEGATIVE for an equity index (the persistent put-side
// "volatility smirk" is one of the most robust stylized facts in index options) — so
// positive = puts bid over calls = fear = BEARISH, negative = calls bid over puts =
// BULLISH. Both scoreSkewConfirmation and scoreFlowQuality's direction-flip branch treated
// positive as bullish — backwards. These tests pin the corrected sign with concrete values.

test("scoreSkewConfirmation: positive skew (puts bid, bearish) confirms SHORT / penalizes LONG — was inverted pre-fix", () => {
  // Real live SPY value from the 2026-07-04 pull (2026-07-02 row): +0.0663.
  // Pre-fix this scored short=-2, long=+3 (backwards). Post-fix:
  assert.equal(scoreSkewConfirmation(0.0663361729210146, "short"), 3);
  assert.equal(scoreSkewConfirmation(0.0663361729210146, "long"), -2);
});

test("scoreSkewConfirmation: negative skew (calls bid, bullish) confirms LONG / penalizes SHORT", () => {
  assert.equal(scoreSkewConfirmation(-0.04, "long"), 3);
  assert.equal(scoreSkewConfirmation(-0.04, "short"), -2);
});

test("scoreSkewConfirmation: null/undefined/0/NaN skew is neutral regardless of direction", () => {
  assert.equal(scoreSkewConfirmation(null, "long"), 0);
  assert.equal(scoreSkewConfirmation(undefined, "short"), 0);
  assert.equal(scoreSkewConfirmation(0, "long"), 0);
  assert.equal(scoreSkewConfirmation(NaN, "short"), 0);
});

test("scoreFlowQuality: strong positive (bearish) skew flips a tied call/put flow from default LONG to SHORT", () => {
  const flows = [
    { type: "call", total_premium: 500_000 },
    { type: "put", total_premium: 500_000 },
  ];
  // Equal call/put weighted premium -> default direction is "long" (tie), flowMargin is 0
  // (< 0.12), so a |skew| >= 0.3 is enough to flip. Pre-fix, +0.5 skew read as "bullish" and
  // matched the existing "long" default, so directionFlippedBySkew was FALSE and direction
  // stayed "long" — the exact inversion this fix corrects.
  const result = scoreFlowQuality(flows, undefined, { riskReversalSkew: 0.5 });
  assert.equal(result.direction, "short");
  assert.equal(result.directionFlippedBySkew, true);
});

test("scoreFlowQuality: strong negative (bullish) skew flips a put-leaning flow from SHORT to LONG", () => {
  const flows = [
    { type: "put", total_premium: 520_000 },
    { type: "call", total_premium: 500_000 },
  ];
  // putWeightedPrem slightly exceeds callWeightedPrem -> default direction "short", margin
  // thin (~0.02, well under 0.12). Pre-fix, -0.5 skew read as "bearish" and matched the
  // existing "short" default (no flip); post-fix it correctly reads as bullish and flips.
  const result = scoreFlowQuality(flows, undefined, { riskReversalSkew: -0.5 });
  assert.equal(result.direction, "long");
  assert.equal(result.directionFlippedBySkew, true);
});

// ── scoreCandidate: tech tiebreaker when flow is ambiguous (PR-N27) ──────────

test("scoreCandidate: bearish tech flips ambiguous call-leaning flow to SHORT (PR-N27)", () => {
  // 52/48 call/put split — margin ~0.077, well under 0.25 threshold
  const flows = [
    { type: "call", total_premium: 520_000 },
    { type: "put", total_premium: 480_000 },
  ];
  const bearishTech = {
    ticker: "TEST", price: 100, trend: "bearish" as const, setup_tags: [],
    support_levels: [], resistance_levels: [], gap_zones: [], breakout_zones: [],
    prior_day: { high: 105, low: 95, close: 100 },
    weekly: { high: null, low: null },
    rsi14: 60, rel_volume: 1.5, atr14: 3, vwap: 100, ema20: 100, ema50: 100, ema200: 100,
    summary: "bearish",
  };
  const result = scoreCandidate("TEST", flows, bearishTech, {});
  assert.equal(result.direction, "short", "bearish tech should flip ambiguous flow to short");
});

test("scoreCandidate: bearish tech does NOT flip strong call-dominant flow (PR-N27)", () => {
  // 80/20 call/put split — margin ~0.6, well above 0.25 threshold
  const flows = [
    { type: "call", total_premium: 4_000_000 },
    { type: "put", total_premium: 1_000_000 },
  ];
  const bearishTech = {
    ticker: "TEST", price: 100, trend: "bearish" as const, setup_tags: [],
    support_levels: [], resistance_levels: [], gap_zones: [], breakout_zones: [],
    prior_day: { high: 105, low: 95, close: 100 },
    weekly: { high: null, low: null },
    rsi14: 60, rel_volume: 1.5, atr14: 3, vwap: 100, ema20: 100, ema50: 100, ema200: 100,
    summary: "bearish",
  };
  const result = scoreCandidate("TEST", flows, bearishTech, {});
  assert.equal(result.direction, "long", "strong flow conviction should override bearish tech");
});

test("scoreCandidate: bullish tech keeps ambiguous flow as LONG (PR-N27)", () => {
  // 51/49 call/put split — margin ~0.02
  const flows = [
    { type: "call", total_premium: 510_000 },
    { type: "put", total_premium: 490_000 },
  ];
  const bullishTech = {
    ticker: "TEST", price: 100, trend: "bullish" as const, setup_tags: [],
    support_levels: [], resistance_levels: [], gap_zones: [], breakout_zones: [],
    prior_day: { high: 105, low: 95, close: 100 },
    weekly: { high: null, low: null },
    rsi14: 55, rel_volume: 1.5, atr14: 3, vwap: 100, ema20: 100, ema50: 100, ema200: 100,
    summary: "bullish",
  };
  const result = scoreCandidate("TEST", flows, bullishTech, {});
  assert.equal(result.direction, "long", "bullish tech confirms ambiguous long flow");
});

// ── scoreOptionsPositioning: dealer greek flow alignment ────────────────────

test("positioning: bullish dealer greek flow adds +3 for LONG", () => {
  const base = scoreOptionsPositioning({}, "long");
  const withGreek = scoreOptionsPositioning(
    { greek_flow: { net_delta: 50_000, net_gamma: 1_000, bias: "bullish", row_count: 5 } },
    "long"
  );
  assert.equal(withGreek - base, 3);
});

test("positioning: bullish dealer greek flow penalizes SHORT (−1 before floor)", () => {
  // From a non-zero base so the -1 penalty is visible.
  const withOi = {
    oi_change: [
      { oi_change: 100, option_type: "put" },
      { oi_change: 200, option_type: "put" },
    ],
  };
  const base = scoreOptionsPositioning(withOi, "short");
  const withGreek = scoreOptionsPositioning(
    { ...withOi, greek_flow: { net_delta: 50_000, net_gamma: 1_000, bias: "bullish", row_count: 5 } },
    "short"
  );
  assert.equal(withGreek - base, -1);
});

test("positioning: bearish dealer greek flow adds +3 for SHORT", () => {
  const base = scoreOptionsPositioning({}, "short");
  const withGreek = scoreOptionsPositioning(
    { greek_flow: { net_delta: -50_000, net_gamma: -1_000, bias: "bearish", row_count: 5 } },
    "short"
  );
  assert.equal(withGreek - base, 3);
});

test("positioning: neutral dealer greek flow has no effect", () => {
  const base = scoreOptionsPositioning({}, "long");
  const withGreek = scoreOptionsPositioning(
    { greek_flow: { net_delta: 500, net_gamma: 100, bias: "neutral", row_count: 3 } },
    "long"
  );
  assert.equal(withGreek, base);
});

test("positioning: null greek_flow has no effect", () => {
  const base = scoreOptionsPositioning({}, "long");
  const withNull = scoreOptionsPositioning({ greek_flow: null }, "long");
  assert.equal(withNull, base);
});

test("positioning: greek flow score still capped at 18 total", () => {
  const result = scoreOptionsPositioning(
    {
      dark_pool: { total_premium: 100_000_000, bias: "bullish" },
      strike_stacks: [
        { strike: 100, repeated_hits: true, same_strike_accumulation: true, option_type: "call" } as any,
      ],
      positioning: { negative_gamma: true } as any,
      oi_change: [
        { oi_change: 100, option_type: "call" },
        { oi_change: 200, option_type: "call" },
      ],
      greek_flow: { net_delta: 50_000, net_gamma: 1_000, bias: "bullish", row_count: 5 },
    },
    "long"
  );
  assert.equal(result, 18);
});

// ── confirming_signals ──────────────────────────────────────────────────────

test("scoreCandidate returns confirming_signals count based on material thresholds", () => {
  const flows = [
    { type: "call", total_premium: 10_000_000, ticker: "TEST" },
    { type: "call", total_premium: 5_000_000, ticker: "TEST" },
  ];
  const result = scoreCandidate("TEST", flows, null, {});
  assert.equal(typeof result.confirming_signals, "number");
  assert.ok(result.confirming_signals! >= 0);
  assert.ok(result.confirming_signals! <= 7);
});

// ── IV rank penalty ────────────────────────────────────────────────────────

test("scoreCandidate: elevated IV rank (>70) adds catalyst flag and penalty", () => {
  const flows = [{ type: "call", total_premium: 5_000_000, ticker: "TEST" }];
  const base = scoreCandidate("TEST", flows, null, {});
  const withHighIv = scoreCandidate("TEST", flows, null, { iv_rank: 85 });
  assert.ok(withHighIv.catalyst_flags!.some((f) => f.includes("IV rank 85")));
  assert.ok(withHighIv.score <= base.score);
});

test("scoreCandidate: moderate IV rank (<=70) has no penalty or flag", () => {
  const flows = [{ type: "call", total_premium: 5_000_000, ticker: "TEST" }];
  const base = scoreCandidate("TEST", flows, null, {});
  const withModIv = scoreCandidate("TEST", flows, null, { iv_rank: 55 });
  assert.equal(withModIv.score, base.score);
  assert.ok(!withModIv.catalyst_flags?.some((f) => f.includes("IV rank")));
});

// ── FDA calendar reinforcement ──────────────────────────────────────────────

test("scoreCandidate: FDA events add penalty when Benzinga didn't already flag FDA", () => {
  const flows = [{ type: "call", total_premium: 5_000_000, ticker: "TEST" }];
  const base = scoreCandidate("TEST", flows, null, {});
  const withFda = scoreCandidate("TEST", flows, null, {
    fda_events: [{ date: "2026-08-01", event_type: "PDUFA" }],
  });
  assert.ok(withFda.catalyst_flags!.some((f) => f.includes("FDA calendar")));
  assert.ok(withFda.score < base.score);
});

test("scoreCandidate: FDA events skip when Benzinga already flagged FDA", () => {
  const flows = [{ type: "call", total_premium: 5_000_000, ticker: "TEST" }];
  const withBenzFda = scoreCandidate("TEST", flows, null, {
    catalysts: [{ type: "binary" }] as never,
  });
  const withBoth = scoreCandidate("TEST", flows, null, {
    catalysts: [{ type: "binary" }] as never,
    fda_events: [{ date: "2026-08-01", event_type: "PDUFA" }],
  });
  assert.equal(withBoth.score, withBenzFda.score);
});

// ── scoreWallProximity ──────────────────────────────────────────────────────────

function mkPositioning(overrides: Partial<PositioningSummary> = {}): PositioningSummary {
  return {
    net_gex: 0, gex_king_strike: null, gamma_flip: null,
    gamma_regime: "unknown", net_vex: null, max_pain: null,
    negative_gamma: false, wall_summary: "n/a",
    ...overrides,
  };
}

test("scoreWallProximity: put wall within 1% of spot → +5 for long", () => {
  const pos = mkPositioning({ wall_summary: "put wall $5690 (-5pts)" });
  assert.equal(scoreWallProximity(pos, "long"), 5);
});

test("scoreWallProximity: put wall within 3% of spot → +3 for long", () => {
  const pos = mkPositioning({ wall_summary: "put wall $100 (-2pts)" });
  assert.equal(scoreWallProximity(pos, "long"), 3);
});

test("scoreWallProximity: call wall within 1% for short → +5", () => {
  const pos = mkPositioning({ wall_summary: "call wall $100 (+1pts)" });
  assert.equal(scoreWallProximity(pos, "short"), 5);
});

test("scoreWallProximity: contradicting call wall close for long → -2", () => {
  const pos = mkPositioning({ wall_summary: "call wall $100 (+1pts)" });
  assert.equal(scoreWallProximity(pos, "long"), -2);
});

test("scoreWallProximity: no positioning → 0", () => {
  assert.equal(scoreWallProximity(null, "long"), 0);
  assert.equal(scoreWallProximity(mkPositioning(), "long"), 0);
});

test("scoreWallProximity: combined supporting + contradicting walls", () => {
  const pos = mkPositioning({ wall_summary: "put wall $5680 (-20pts) · call wall $5720 (+20pts)" });
  const score = scoreWallProximity(pos, "long");
  assert.ok(score >= 1, `expected >= 1, got ${score}`);
});

// ── scoreVexAlignment ───────────────────────────────────────────────────────────

test("scoreVexAlignment: positive VEX aligns with long → +3", () => {
  assert.equal(scoreVexAlignment(mkPositioning({ net_vex: 50000 }), "long"), 3);
});

test("scoreVexAlignment: negative VEX aligns with short → +3", () => {
  assert.equal(scoreVexAlignment(mkPositioning({ net_vex: -50000 }), "short"), 3);
});

test("scoreVexAlignment: positive VEX contradicts short → -1", () => {
  assert.equal(scoreVexAlignment(mkPositioning({ net_vex: 50000 }), "short"), -1);
});

test("scoreVexAlignment: null VEX → 0", () => {
  assert.equal(scoreVexAlignment(mkPositioning({ net_vex: null }), "long"), 0);
});

test("scoreVexAlignment: zero VEX → 0", () => {
  assert.equal(scoreVexAlignment(mkPositioning({ net_vex: 0 }), "long"), 0);
});

// ── computeRegimeMultiplier (widened range) ─────────────────────────────────────

test("computeRegimeMultiplier: extreme bearish VIX>80 → 0.6", () => {
  const m = computeRegimeMultiplier({ vix_iv_rank: 85, tide_bias: "BEARISH" as const, advance_pct: null });
  assert.equal(m, 0.6);
});

test("computeRegimeMultiplier: extreme bullish VIX<20 → 1.2 base", () => {
  const m = computeRegimeMultiplier({ vix_iv_rank: 15, tide_bias: "BULLISH" as const, advance_pct: null });
  assert.equal(m, 1.2);
});

test("computeRegimeMultiplier: trending composite regime adds 0.05", () => {
  const base = computeRegimeMultiplier({ vix_iv_rank: 30, tide_bias: "NEUTRAL" as const, advance_pct: null });
  const trending = computeRegimeMultiplier({ vix_iv_rank: 30, tide_bias: "NEUTRAL" as const, advance_pct: null, composite_regime: "trending_up" });
  assert.ok(trending > base, `trending ${trending} should exceed base ${base}`);
});

test("computeRegimeMultiplier: cap at 1.30", () => {
  const m = computeRegimeMultiplier({ vix_iv_rank: 15, tide_bias: "BULLISH" as const, advance_pct: 80, composite_regime: "breakout" });
  assert.ok(m <= 1.30, `should be <= 1.30, got ${m}`);
});

// ── rankingScore ────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<ScoredCandidate>): ScoredCandidate {
  return {
    ticker: "TEST",
    score: 50,
    direction: "long",
    flow_score: 20,
    tech_score: 10,
    pos_score: 8,
    news_score: 4,
    smart_money_score: 3,
    conviction: "B",
    ...overrides,
  };
}

test("rankingScore: clean candidate returns base score when < 3 confirming signals", () => {
  const c = makeCandidate({ score: 60, confirming_signals: 2 });
  assert.equal(rankingScore(c), 60);
});

test("rankingScore: confluence bonus adds +2 per signal above floor", () => {
  const c = makeCandidate({ score: 50, confirming_signals: 5 });
  // 5 signals: (5 - 3 + 1) * 2 = 6 bonus
  assert.equal(rankingScore(c), 56);
});

test("rankingScore: fundamental_block applies -10 penalty", () => {
  const c = makeCandidate({ score: 70, fundamental_block: true, confirming_signals: 2 });
  assert.equal(rankingScore(c), 60);
});

test("rankingScore: penalty + bonus combine correctly", () => {
  const c = makeCandidate({ score: 70, fundamental_block: true, confirming_signals: 5 });
  // -10 penalty + (5-3+1)*2 = -10 + 6 = -4 net
  assert.equal(rankingScore(c), 66);
});

test("rankCandidates: high-scoring flagged candidate outranks low-scoring clean one", () => {
  const flagged = makeCandidate({ ticker: "FLAG", score: 85, fundamental_block: true, confirming_signals: 5 });
  const clean = makeCandidate({ ticker: "CLEAN", score: 40, fundamental_block: false, confirming_signals: 2 });
  const { ranked } = rankCandidates([clean, flagged], 5);
  assert.equal(ranked[0]!.ticker, "FLAG", "high-scoring flagged should rank first");
});

test("rankCandidates: close scores favor clean over flagged", () => {
  const flagged = makeCandidate({ ticker: "FLAG", score: 55, fundamental_block: true, confirming_signals: 2 });
  const clean = makeCandidate({ ticker: "CLEAN", score: 50, fundamental_block: false, confirming_signals: 2 });
  const { ranked } = rankCandidates([flagged, clean], 5);
  assert.equal(ranked[0]!.ticker, "CLEAN", "clean should outrank when scores are close (penalty -10)");
});

