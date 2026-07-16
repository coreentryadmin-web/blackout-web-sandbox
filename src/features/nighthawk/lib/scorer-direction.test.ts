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
} from "./scorer";
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

