import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { computeSpxConfluence } from "./spx-signals";

// PROOF THIS PR DOES NOT CHANGE LIVE SIGNALS
// ───────────────────────────────────────────────────────────────────────────
// The spx-shadow-signal-framework PR adds a new file (spx-signals-shadow.ts),
// a new DB table, and one new fire-and-forget call site in spx-play-engine.ts
// — but ZERO lines in THIS file (spx-signals.ts, the pure confluence engine
// that gates real-money 0DTE BUY_CALL/BUY_PUT recommendations). `git diff
// main -- src/features/spx/lib/spx-signals.ts` for that PR is empty.
//
// This test is the belt-and-suspenders proof that matters more than the diff:
// it feeds computeSpxConfluence() a fixture desk exercising ~20 of the ~21
// possible factors (VWAP, gamma regime, GEX support/resistance/anchor, max
// pain, 0DTE flow, dark pool, tide, NOPE, IV rank, TICK/TRIN/ADD, mega-caps,
// live tape, EMA20, net premium, VIX curve, HELIX sweeps, news risk, strike
// stack) and asserts the ENTIRE returned object — score, grade, action,
// confidence, factors array (labels + weights + details, in order), and
// levels — is byte-for-byte identical to a value captured from this exact
// code path. Any future change to spx-signals.ts (from this PR or any other)
// that shifts so much as one weight, one factor label, or the grade/action
// thresholds fails this test immediately.
//
// Session-window scoring (etCk / nowEtMins in computeSpxConfluence) reads the
// wall clock directly, so `now` is frozen via node:test's MockTimers to a
// fixed ET timestamp (14:00 ET / 18:00 UTC on 2026-07-04, a Saturday for the
// mocked date but the function does not gate on weekday) that falls outside
// all three named session windows (morning ORB 9:50-11:30, lunch chop
// 11:30-13:00, power hour 15:00-15:30) so the "Session window" factor does
// not fire and does not need to be part of the golden fixture below.

function richDesk(): SpxDeskPayload {
  return {
    available: true,
    as_of: "2026-07-04T18:00:00.000Z",
    source: "polygon",
    price: 7420,
    spx_change_pct: 0.6,
    vix: 13,
    vix_change_pct: null,
    above_vwap: true,
    lod: 7350,
    hod: 7430,
    vwap: 7400,
    pdh: 7410,
    pdl: 7340,
    prior_close: 7380,
    gap_pct: null,
    gap_source: null,
    ema20: 7400,
    ema50: 7380,
    ema200: 7200,
    sma50: 7370,
    sma200: 7180,
    tick: 250,
    trin: 0.8,
    add: 600,
    gex_net: 1_000_000,
    gex_king: 7415,
    max_pain: 7430,
    gamma_flip: 7380,
    above_gamma_flip: true,
    gamma_regime: "mean_revert",
    gex_walls: [
      { strike: 7410, net_gex: 500_000, kind: "support", distance_pts: 10 },
      { strike: 7460, net_gex: -500_000, kind: "resistance", distance_pts: 40 },
    ],
    flow_0dte_call_premium: 300_000,
    flow_0dte_put_premium: 0,
    flow_0dte_net: 300_000,
    tide_bias: "bullish",
    tide_call_premium: 500_000,
    tide_put_premium: 100_000,
    tide_net: 400_000,
    nope: 0.8,
    nope_net_delta: null,
    uw_iv_rank: 75,
    regime: "bullish",
    levels: [],
    dark_pool: {
      prints: [],
      total_premium: 200_000,
      call_premium: 150_000,
      put_premium: 50_000,
      bias: "bullish",
      pcr: 0.33,
      detail: "",
    },
    spx_flows: [
      {
        ticker: "SPX",
        premium: 1_200_000,
        option_type: "C",
        strike: 7425,
        expiry: "2026-07-04",
        direction: "bullish",
        alerted_at: "2026-07-04T17:50:00.000Z",
        alert_rule: null,
        trade_count: 10,
        has_sweep: true,
      },
      {
        ticker: "SPX",
        premium: 100_000,
        option_type: "P",
        strike: 7350,
        expiry: "2026-07-04",
        direction: "bearish",
        alerted_at: "2026-07-04T17:50:00.000Z",
        alert_rule: null,
        trade_count: 2,
        has_sweep: true,
      },
    ],
    unified_tape: [
      { kind: "flow", side: "call", time: "2026-07-04T17:55:00.000Z", label: "SPX C", premium: 260_000, detail: "" },
      { kind: "flow", side: "put", time: "2026-07-04T17:54:00.000Z", label: "SPX P", premium: 50_000, detail: "" },
    ],
    strike_stacks: [
      {
        ticker: "SPX",
        strike: 7425,
        option_type: "CALL",
        expiry: "2026-07-04",
        alert_count: 5,
        total_premium: 900_000,
        premiums: [200_000, 200_000, 200_000, 150_000, 150_000],
        trade_count: 5,
        repeated_hits: true,
        same_strike_accumulation: true,
      },
    ],
    net_prem_ticks: [
      { time: "2026-07-04T17:00:00.000Z", net: 100_000 },
      { time: "2026-07-04T17:30:00.000Z", net: 700_000 },
    ],
    vix_term: { vix9d: 14, vix3m: 16, structure: "contango", detail: "" },
    data_quality: { vix_term_partial: false, missing: [] },
    sector_heat: [],
    leader_stocks: [{ name: "Apple", ticker: "AAPL", change_pct: 1.0 }],
    oi_changes: [],
    iv_term_structure: [],
    macro_events: [],
    news_headlines: [
      { title: "Markets rally on dovish rate cut hopes", published: "2026-07-04T17:00:00.000Z", tickers: [] },
      {
        title: "Stocks close at record high after strong earnings beat estimates",
        published: "2026-07-04T17:10:00.000Z",
        tickers: [],
      },
    ],
    greek_exposure: null,
    flow_by_expiry: [],
    net_flow_by_expiry: [],
    market_breadth: null,
    mag7_greek_flow: null,
    macro_indicators: [],
    market_open: true,
    polled_at: "2026-07-04T18:00:00.000Z",
  };
}

const GOLDEN = {
  action: "BUY_CALL",
  bias: "bullish",
  confidence: 96,
  score: 100,
  grade: "A+",
  conflicts: 1,
  weighted_conflicts: 2,
  agreeing: 20,
  direction: "long",
  headline: "",
  thesis: "",
  factors: [
    { label: "GEX support", weight: 18, detail: "At 0DTE support node 7410 (+10 pts)" },
    {
      label: "HELIX sweeps",
      weight: 15,
      detail: "0DTE call sweeps dominant — $1.2M vs $0.1M puts (30min)",
    },
    { label: "0DTE flow", weight: 14, detail: "Call premium leading 0DTE tape" },
    { label: "VWAP", weight: 12, detail: "Above VWAP 7400.00 — buyers in control" },
    { label: "Live tape", weight: 12, detail: "Recent SPX flow skews calls" },
    { label: "γ regime", weight: 10, detail: "Above γ flip 7380 — mean-revert favors dips bought" },
    { label: "Market tide", weight: 10, detail: "bullish broad flow" },
    { label: "TICK", weight: 8, detail: "NYSE TICK +250" },
    { label: "NOPE", weight: 7, detail: "NOPE +0.80" },
    { label: "GEX anchor", weight: 6, detail: "Above anchor strike 7415" },
    { label: "TRIN", weight: 6, detail: "TRIN 0.80 — broad buying" },
    { label: "Mega-caps", weight: 6, detail: "Leadership avg +1.00%" },
    { label: "Net prem", weight: 6, detail: "SPY net prem accelerating" },
    { label: "Max pain", weight: 5, detail: "Price below max pain 7430" },
    { label: "ADD", weight: 5, detail: "Advance/decline +600" },
    { label: "EMA 20", weight: 5, detail: "Above intraday EMA 20" },
    { label: "IV rank", weight: -4, detail: "High IV rank 75 — fade risk on longs" },
    {
      label: "VIX curve",
      weight: 4,
      detail: "VIX contango: 9d 14.0 < 3m 16.0 — calm near-term structure",
    },
    { label: "Dark pool", weight: 3, detail: "Institutional bias bullish" },
    { label: "News risk", weight: 3, detail: "2 positive headlines (rate cut/deal/beat)" },
    { label: "Strike stack", weight: 3, detail: "CALL $7425 — 5 repeated prints (long)" },
  ],
  levels: {
    entry: 7420,
    stop: 7407,
    target: 7432,
    invalidation: "Below 7407 (GEX support wall − 3pt)",
  },
  as_of: "2026-07-04T18:00:00.000Z",
};

test("computeSpxConfluence: byte-for-byte unchanged output for a rich fixture desk (shadow-framework PR proof)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const result = computeSpxConfluence(richDesk());
  assert.ok(result);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), GOLDEN);
});

test("computeSpxConfluence: calling it twice in a row (as the shadow wiring's fire-and-forget call now does downstream) returns the identical object shape both times", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const desk = richDesk();
  const first = computeSpxConfluence(desk);
  const second = computeSpxConfluence(desk);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});
