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
    gate: null,
    cortex: null,
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

test("mergePlays: hard-gate-BLOCKED fresh find is SKIP even in-range during RTH (parity with zeroDtePlaysForLargo)", () => {
  const setup = fakeSetup("META", {
    occ: "M",
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
  const blocked = fakeSetup("META", setup);
  blocked.gate = {
    verdict: "BLOCKED",
    blocks: [
      {
        code: "tape_alignment",
        reason: "Long setup fights the DOWN market tape — counter-tape 0DTE entries are blocked.",
        threshold: null,
        unlock_et: null,
      },
    ],
    calibration: {
      score_at_commit: 75,
      market_bias: "down",
      committed_at_et: "10:15",
      g4_vix: { day_open_vix: null, tier: "unknown", would_block: false, would_halve_size: false, note: "n/a" },
      g6_conflict: { conflict: false, against: [], would_block: false, note: "No cross-system conflict." },
    },
  };
  const rows = mergePlays([blocked], [], "RTH");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "SKIP");
  assert.equal(rows[0]!.committed, false);
});

test("mergePlays: ledger row merges live setup evidence (committed, expiry carried)", () => {
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
        expiry: "2026-07-07",
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
  assert.equal(rows[0]!.committed, true);
  assert.equal(rows[0]!.expiry, "2026-07-07");
});

test("mergePlays: ledger row's PINNED entry_context.cortex blob wins over the setup's live assessment", () => {
  const setup = fakeSetup("NVDA", null);
  // Live setup carries a later assessment (nested shape)…
  setup.cortex = {
    decision: "PASS",
    abstained: false,
    verdict: {
      ticker: "NVDA",
      direction: "long",
      asOf: "2026-07-14T15:00:00.000Z",
      vetoes: [],
      score: 1.1,
      supports: [{ source: "gex-walls", stance: "supports", weight: 1.1, halfLifeSec: 900, asOf: "2026-07-14T15:00:00.000Z", detail: "later read" }],
      opposes: [],
      absent: [],
      conviction: "B",
      narrative: [],
    },
  };
  const rows = mergePlays(
    [setup],
    [
      {
        ticker: "NVDA",
        direction: "long",
        score_max: 80,
        spike: false,
        first_flagged_at: new Date().toISOString(),
        underlying_at_flag: 138,
        top_strike: 140,
        conviction: null,
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
        // …but the ledger row carries the commit-time blob (flattened shape) —
        // the evidence that actually gated the money is what the card must show.
        cortex: {
          abstained: false,
          decision: "PASS",
          as_of: "2026-07-14T14:00:00.000Z",
          score: 2.4,
          conviction: "A",
          vetoes: [],
          supports: [{ source: "wall-trend", stance: "supports", weight: 2.4, halfLifeSec: 900, asOf: "2026-07-14T14:00:00.000Z", detail: "commit-time read" }],
          opposes: [],
          absent: [],
          narrative: [],
        },
      },
    ],
    "RTH"
  );
  const view = rows[0]!.cortex;
  assert.ok(view && !view.abstained);
  assert.equal(view.verdict.score, 2.4);
  assert.equal(view.verdict.supports[0]!.detail, "commit-time read");
});

test("mergePlays: pre-wire-in ledger row with no cortex anywhere carries a null view (honest gates-only line)", () => {
  const rows = mergePlays(
    [],
    [
      {
        ticker: "MU",
        direction: "long",
        score_max: 70,
        spike: false,
        first_flagged_at: new Date().toISOString(),
        underlying_at_flag: 100,
        top_strike: 105,
        conviction: null,
        entry_premium: 2,
        flow_avg_fill: 2,
        status: "HOLD",
        last_mark: 2.1,
        live_pnl_pct: 5,
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
  assert.equal(rows[0]!.cortex, null);
});

test("mergePlays: ledger row without its own expiry falls back to the live setup's expiry", () => {
  const rows = mergePlays(
    [fakeSetup("NVDA", null)], // fakeSetup expiry = 2026-07-07
    [
      {
        ticker: "NVDA",
        direction: "long",
        score_max: 80,
        spike: false,
        first_flagged_at: new Date().toISOString(),
        underlying_at_flag: 138,
        top_strike: 140,
        conviction: null,
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
  assert.equal(rows[0]!.expiry, "2026-07-07");
});

// ── B-9 live-marks overlay (overlayLiveMark) ───────────────────────────────────────

import { overlayLiveMark } from "./ZeroDteBoard";
import type { ZeroDteLiveMarkRow } from "@/lib/zerodte/live-marks";

function playRow(over: Partial<Parameters<typeof overlayLiveMark>[0]>): Parameters<typeof overlayLiveMark>[0] {
  return {
    ticker: "NVDA",
    direction: "long",
    strike: 140,
    expiry: null,
    status: "HOLD",
    committed: true,
    entry_premium: 4.2,
    flow_avg_fill: 4.2,
    conviction: null,
    last_mark: 4.4,
    live_pnl_pct: 4.76,
    closed_reason: null,
    plan_outcome: null,
    plan_pnl_pct: null,
    first_flagged_at: new Date().toISOString(),
    score: 80,
    spike: false,
    setup: null,
    cortex: null,
    nighthawkEcho: null,
    ...over,
  };
}

function liveRow(over: Partial<ZeroDteLiveMarkRow>): ZeroDteLiveMarkRow {
  return {
    ticker: "NVDA",
    occ: "O:NVDA260714C00140000",
    direction: "long",
    strike: 140,
    status: "HOLD",
    entry_premium: 4.2,
    bid: 4.6,
    ask: 4.64,
    mid: 4.62,
    last: 4.6,
    mark: 4.62,
    source: "mid",
    mark_as_of: new Date().toISOString(),
    mark_age_ms: 100,
    stale: false,
    live_pnl_pct: 10,
    ...over,
  };
}

test("overlayLiveMark: fresh pushed mark replaces the board mark; P&L is the PUSHED value, never recomputed", () => {
  const now = Date.now();
  const out = overlayLiveMark(playRow({}), liveRow({ mark_as_of: new Date(now - 500).toISOString() }), now);
  assert.equal(out.last_mark, 4.62);
  assert.equal(out.live_pnl_pct, 10); // exactly what the server pushed (single derivation)
  assert.equal(out.mark_source, "mid");
  assert.equal(out.mark_stale, false);
  // The two-sided quote behind the mark rides along for the card's bid×ask display.
  assert.equal(out.mark_bid, 4.6);
  assert.equal(out.mark_ask, 4.64);
});

test("overlayLiveMark: a mark older than the 5s honesty bar renders STALE (dim), never as live", () => {
  const now = Date.now();
  const out = overlayLiveMark(playRow({}), liveRow({ mark_as_of: new Date(now - 8_000).toISOString() }), now);
  assert.equal(out.last_mark, 4.62); // still the freshest number we have…
  assert.equal(out.mark_stale, true); // …but flagged, not impersonating live
});

test("overlayLiveMark: CLOSED and SKIP rows are frozen — the live lane never rewrites them", () => {
  const now = Date.now();
  const closed = overlayLiveMark(playRow({ status: "CLOSED", last_mark: 2.6, live_pnl_pct: -50 }), liveRow({}), now);
  assert.equal(closed.last_mark, 2.6);
  assert.equal(closed.live_pnl_pct, -50);
  assert.equal(closed.mark_stale, false); // frozen result, no staleness claim
  const skip = overlayLiveMark(playRow({ status: "SKIP" }), liveRow({}), now);
  assert.equal(skip.last_mark, 4.4);
});

test("overlayLiveMark: no pushed row → board values stand, staleness judged from the board's own asOf", () => {
  const now = Date.now();
  const fresh = overlayLiveMark(playRow({ mark_as_of: new Date(now - 1_000).toISOString() }), undefined, now);
  assert.equal(fresh.mark_stale, false);
  const old = overlayLiveMark(playRow({ mark_as_of: new Date(now - 20_000).toISOString() }), undefined, now);
  assert.equal(old.mark_stale, true);
  // Legacy lane (no per-quote timestamp anywhere): no staleness claim either way.
  const unknown = overlayLiveMark(playRow({}), undefined, now);
  assert.equal(unknown.mark_stale, undefined);
});

test("overlayLiveMark: an OLDER pushed mark never overwrites a fresher board mark", () => {
  const now = Date.now();
  const out = overlayLiveMark(
    playRow({ mark_as_of: new Date(now - 1_000).toISOString(), last_mark: 4.7 }),
    liveRow({ mark_as_of: new Date(now - 4_000).toISOString(), mark: 4.1 }),
    now
  );
  assert.equal(out.last_mark, 4.7);
});
