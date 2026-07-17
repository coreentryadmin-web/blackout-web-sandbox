// Hermetic: extractCandidateTickers consults Postgres (baseline premium + streaks)
// when a DATABASE_URL is present. These are pure-logic tests — blank the env BEFORE
// any import so dbConfigured() reads false at call time and no connection is attempted
// (the audit sandbox has the env set but Postgres TCP blocked → 10s hangs otherwise).
process.env.DATABASE_URL = "";
process.env.DATABASE_PUBLIC_URL = "";

import assert from "node:assert/strict";
import test from "node:test";
import { isExcludedInstrument, extractCandidateTickers, extractMultiSourceCandidates } from "./candidates";
import { computeFlowStreakFromBuckets } from "./flow-streak";
import type { MarketWideContext } from "./market-wide";

// Batch C regression suite (2026-07-02 audit): discovery-quality filters,
// cross-source seeds, and consecutive-trading-day streaks.

// ── instrument filter ────────────────────────────────────────────────────────────

test("excludes leveraged/inverse ETPs and VIX wrappers", () => {
  for (const t of ["TQQQ", "SQQQ", "SOXL", "UVXY", "VXX", "NVDL", "TSLL"]) {
    assert.equal(isExcludedInstrument(t), true, t);
  }
});

test("excludes SPAC-suffix warrants/units/rights", () => {
  for (const t of ["ABCDW", "ABCDU", "ABCDR", "ACME.WS", "ACME-WT", "FOO.U"]) {
    assert.equal(isExcludedInstrument(t), true, t);
  }
});

test("keeps normal single names incl. 4-letter tickers ending in W/U/R", () => {
  for (const t of ["NVDA", "AMD", "MRK", "SNOW", "BIDU", "THOR", "XOM", "A"]) {
    assert.equal(isExcludedInstrument(t), false, t);
  }
});

// ── candidate extraction: floor, exclusion, cross-source ────────────────────────

function flowRow(ticker: string, prem: number, extra: Record<string, unknown> = {}) {
  return { ticker, total_premium: prem, strike: 100, expiry: "2026-08-21", ...extra };
}

test("penny names are dropped only when a row carried the underlying price", async () => {
  const flows = [
    flowRow("PENY", 900_000, { underlying_price: 0.8 }),
    flowRow("REAL", 900_000, { underlying_price: 42 }),
    flowRow("NOPX", 900_000), // no price on the row — must NOT be evicted
  ];
  const out = await extractCandidateTickers(flows, [], 10);
  assert.ok(!out.includes("PENY"));
  assert.ok(out.includes("REAL"));
  assert.ok(out.includes("NOPX"));
});

test("leveraged ETPs never reach the candidate list", async () => {
  const flows = [flowRow("TQQQ", 5_000_000), flowRow("NVDA", 1_000_000)];
  const out = await extractCandidateTickers(flows, [], 10);
  assert.deepEqual(out, ["NVDA"]);
});

test("top-net-impact rows seed candidates (cross-source corroboration)", async () => {
  const out = await extractCandidateTickers([], [], 10, {
    topNetImpact: [{ ticker: "CORR", net_premium: 2_000_000 }],
  });
  assert.deepEqual(out, ["CORR"]);
});

// ── streak continuity ────────────────────────────────────────────────────────────

test("streak counts consecutive trading days, not bucket entries", () => {
  // Mon 06-29, skip Tue, Wed 07-01 — same direction but NOT consecutive.
  const gappy = [
    { day: "2026-07-01", net: 500_000, call: 1, put: 0 },
    { day: "2026-06-29", net: 400_000, call: 1, put: 0 },
  ];
  assert.equal(computeFlowStreakFromBuckets(gappy).streak_days, 1);

  const consecutive = [
    { day: "2026-07-01", net: 500_000, call: 1, put: 0 },
    { day: "2026-06-30", net: 400_000, call: 1, put: 0 },
    { day: "2026-06-29", net: 300_000, call: 1, put: 0 },
  ];
  assert.equal(computeFlowStreakFromBuckets(consecutive).streak_days, 3);
});

test("weekends and the 2026-07-03 holiday do not break a streak", () => {
  // Thu 07-02 ← (Fri holiday, weekend) ← Mon 07-06: consecutive TRADING days.
  const spanning = [
    { day: "2026-07-06", net: 500_000, call: 1, put: 0 },
    { day: "2026-07-02", net: 400_000, call: 1, put: 0 },
    { day: "2026-07-01", net: 300_000, call: 1, put: 0 },
  ];
  assert.equal(computeFlowStreakFromBuckets(spanning).streak_days, 3);
});

test("direction flip still breaks the streak", () => {
  const flipped = [
    { day: "2026-07-01", net: 500_000, call: 1, put: 0 },
    { day: "2026-06-30", net: -400_000, call: 0, put: 1 },
  ];
  assert.equal(computeFlowStreakFromBuckets(flipped).streak_days, 1);
});

// ── multi-source candidate extraction ─────────────────────────────────────────

function emptyCtx(): MarketWideContext {
  return {
    today: "2026-07-17",
    tomorrow: "2026-07-18",
    tide: null,
    stock_flows: [],
    hot_chains: [],
    index_flows: {},
    spx_bars: [],
    spx_intraday_5m: [],
    spx_gap: null,
    vix_bars: [],
    market_news: [],
    macro_events: [],
    tomorrow_earnings: [],
    sector_tides: [],
    etf_tides: {},
    sector_performance: [],
    top_net_impact: [],
    vix_term: [],
    vix_iv_rank: null,
    market_breadth: null,
    predictions_consensus: [],
    mag7_greek_flow: null,
    macro_indicators: [],
    after_hours_catalysts: [],
    total_options_volume: null,
    market_oi_change: [],
    platform_intel: null,
    unusual_trades: [],
    market_movers: [],
  } as unknown as MarketWideContext;
}

test("multi-source: flow-only candidates are discovered", async () => {
  const ctx = emptyCtx();
  ctx.stock_flows = [
    { ticker: "NVDA", total_premium: 5_000_000, underlying_price: 150, has_sweep: true },
    { ticker: "AMD", total_premium: 2_000_000, underlying_price: 120 },
  ];
  const out = await extractMultiSourceCandidates(ctx, 10);
  assert.ok(out.includes("NVDA"));
  assert.ok(out.includes("AMD"));
});

test("multi-source: OI-change lane adds new tickers", async () => {
  const ctx = emptyCtx();
  ctx.market_oi_change = [
    { ticker: "TSLA", oi_change: 50000 },
    { ticker: "MSFT", oi_change: 30000 },
  ];
  const out = await extractMultiSourceCandidates(ctx, 10);
  assert.ok(out.includes("TSLA"));
  assert.ok(out.includes("MSFT"));
});

test("multi-source: corroboration boosts multi-lane tickers", async () => {
  const ctx = emptyCtx();
  ctx.stock_flows = [
    { ticker: "NVDA", total_premium: 5_000_000, underlying_price: 150 },
    { ticker: "SOLO", total_premium: 4_500_000, underlying_price: 80 },
  ];
  ctx.market_oi_change = [{ ticker: "NVDA", oi_change: 30000 }];
  ctx.market_movers = [{ ticker: "NVDA", change_pct: 3.5, price: 150 }];
  const out = await extractMultiSourceCandidates(ctx, 2);
  assert.equal(out[0], "NVDA", "NVDA should rank first due to 3-lane corroboration (1.3x)");
});

test("multi-source: excluded instruments are filtered across all lanes", async () => {
  const ctx = emptyCtx();
  ctx.stock_flows = [{ ticker: "TQQQ", total_premium: 10_000_000 }];
  ctx.market_oi_change = [{ ticker: "SQQQ", oi_change: 100000 }];
  ctx.market_movers = [{ ticker: "UVXY", change_pct: 15, price: 30 }];
  const out = await extractMultiSourceCandidates(ctx, 10);
  assert.equal(out.length, 0);
});

test("multi-source: predictions lane contributes directional tickers", async () => {
  const ctx = emptyCtx();
  ctx.predictions_consensus = [
    { ticker: "META", direction: "bullish", confidence_pct: 85, sources: ["a", "b"], headline: "test" },
    { ticker: "NFLX", direction: "neutral", confidence_pct: 50, sources: ["c"], headline: "test" },
  ];
  const out = await extractMultiSourceCandidates(ctx, 10);
  assert.ok(out.includes("META"));
  assert.ok(!out.includes("NFLX"), "neutral predictions should be excluded");
});

test("multi-source: penny stocks filtered from movers lane", async () => {
  const ctx = emptyCtx();
  ctx.market_movers = [
    { ticker: "CHEAP", change_pct: 50, price: 1.50 },
    { ticker: "GOOD", change_pct: 8, price: 45 },
  ];
  const out = await extractMultiSourceCandidates(ctx, 10);
  assert.ok(!out.includes("CHEAP"));
  assert.ok(out.includes("GOOD"));
});

test("multi-source: empty context returns empty list", async () => {
  const out = await extractMultiSourceCandidates(emptyCtx(), 10);
  assert.equal(out.length, 0);
});
