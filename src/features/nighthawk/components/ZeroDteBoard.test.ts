import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveZeroDteFreshness, mergePlays } from "./ZeroDteBoard";
import type { EnrichedZeroDteSetup } from "@/lib/zerodte/board";
import type { ContractPlan } from "@/lib/zerodte/plan";

test("resolveZeroDteFreshness: upstream_ok=false always reads offline, regardless of age", () => {
  assert.equal(resolveZeroDteFreshness(false, Date.now(), Date.now()), "offline");
  // Even a fresh as_of can't paper over a scan that couldn't see the tape this cycle.
  assert.equal(resolveZeroDteFreshness(false, 1000, 1000), "offline");
});

test("resolveZeroDteFreshness: fresh response with a healthy upstream reads live", () => {
  const now = 1_000_000;
  assert.equal(resolveZeroDteFreshness(true, now - 5_000, now), "live");
});

test("resolveZeroDteFreshness: response older than the stale threshold reads stale, not live", () => {
  // Regression: this is the exact bug the audit found -- ZeroDteBoard.tsx hardcoded
  // status="live" unconditionally, so a stuck feed (upstream healthy but as_of not
  // advancing) rendered identically to a genuinely current board.
  const now = 1_000_000;
  assert.equal(resolveZeroDteFreshness(true, now - 61_000, now), "stale");
  assert.equal(resolveZeroDteFreshness(true, now - 59_000, now), "live");
});

test("resolveZeroDteFreshness: missing as_of (0) never falsely reports stale", () => {
  assert.equal(resolveZeroDteFreshness(true, 0, 1_000_000), "live");
});

test("resolveZeroDteFreshness: respects a custom staleAfterMs threshold", () => {
  const now = 1_000_000;
  assert.equal(resolveZeroDteFreshness(true, now - 5_000, now, 3_000), "stale");
  assert.equal(resolveZeroDteFreshness(true, now - 2_000, now, 3_000), "live");
});

function fakeSetup(ticker: string, plan: ContractPlan | null): EnrichedZeroDteSetup {
  return {
    ticker,
    direction: "long",
    top_strike: 100,
    expiry: "2026-07-07",
    dte: 0,
    net_premium: 1_000_000,
    gross_premium: 2_000_000,
    prints: 5,
    sweep_pct: 0.2,
    side_dominance: 0.8,
    underlying_price: 98,
    score: 75,
    top_strike_avg_fill: 4.2,
    aggression: 0.6,
    otm_pct: 2,
    new_money: true,
    recent_premium_30m: 1_000_000,
    spike: false,
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    dossier_score: null,
    conviction: null,
    direction_confirmed: null,
    factor_breakdown: null,
    trend: null,
    tech_tags: [],
    breakout_zones: [],
    key_supports: [],
    key_resistances: [],
    vwap: null,
    atr14: null,
    rsi14: null,
    rel_volume: null,
    streak_days: null,
    dark_pool_bias: null,
    gex_king_strike: null,
    gamma_regime: null,
    intraday: null,
    intraday_conflict: false,
    market_aligned: null,
    tod_label: null,
    catalyst_flags: [],
    analyst_note: null,
    fib_note: null,
    plan,
    halted: false,
    earnings: null,
    news_hot: null,
  };
}

test("mergePlays: fresh find after 15:00 ET cutoff shows SKIP not OPEN", () => {
  const plan = fakeSetup("TSLA", {
    occ: "T",
    flow_avg_fill: 4.2,
    bid: 4,
    ask: 4.4,
    mark: 4.2,
    entry_max: 4.2,
    vs_flow_pct: 0,
    entry_status: "IN_RANGE",
    spread_pct: 5,
    illiquid: false,
    stop_premium: 2.1,
    target_premium: 8.4,
    time_stop_et: "15:30",
    underlying_target: null,
    underlying_invalid: null,
  }).plan!;
  const rows = mergePlays([fakeSetup("TSLA", plan)], [], "POWER_HOUR");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "SKIP");
});

test("mergePlays: MOVED entry_status always SKIP even during RTH", () => {
  const plan = fakeSetup("AMD", {
    occ: "A",
    flow_avg_fill: 4.2,
    bid: 6,
    ask: 6.5,
    mark: 6,
    entry_max: 4.2,
    vs_flow_pct: 40,
    entry_status: "MOVED",
    spread_pct: 5,
    illiquid: false,
    stop_premium: 2.1,
    target_premium: 8.4,
    time_stop_et: "15:30",
    underlying_target: null,
    underlying_invalid: null,
  }).plan!;
  const rows = mergePlays([fakeSetup("AMD", plan)], [], "RTH");
  assert.equal(rows[0]!.status, "SKIP");
});

test("mergePlays: ledger row merges live setup evidence", () => {
  const setup = fakeSetup("NVDA", null);
  const rows = mergePlays(
    [setup],
    [
      {
        ticker: "NVDA",
        direction: "long",
        score_max: 80,
        spike: true,
        first_flagged_at: new Date().toISOString(),
        underlying_at_flag: 138,
        top_strike: 140,
        conviction: "high",
        entry_premium: 4.2,
        flow_avg_fill: 4.2,
        status: "HOLD",
        last_mark: 4.5,
        live_pnl_pct: 7.14,
        move_pct: null,
        direction_hit: null,
        plan_outcome: null,
        plan_pnl_pct: null,
        graded: false,
        nighthawk_echo: null,
      },
    ],
    "RTH"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "HOLD");
  assert.equal(rows[0]!.setup?.ticker, "NVDA");
});
