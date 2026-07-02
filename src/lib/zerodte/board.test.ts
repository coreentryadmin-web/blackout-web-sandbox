import assert from "node:assert/strict";
import test from "node:test";
import {
  computeLedgerGrade,
  sessionHeat,
  deriveZeroDteSetups,
  rankEngineCards,
  enrichSetup,
  matchEarnings,
  matchHotNews,
  type FlowSetupInput,
  type SetupDossierView,
  type ZeroDteSetup,
} from "./board";
import { computeFibLevels, nearestFibNote } from "./fib";

// ── session heat ─────────────────────────────────────────────────────────────────

test("heat: holiday/weekend is CLOSED regardless of clock", () => {
  assert.equal(sessionHeat(11 * 60, false).state, "CLOSED");
});

test("heat: full ramp through a trading day", () => {
  assert.equal(sessionHeat(8 * 60, true).state, "PRE_MARKET");
  assert.equal(sessionHeat(9 * 60 + 45, true).state, "OPENING_DRIVE");
  assert.equal(sessionHeat(12 * 60, true).state, "RTH");
  assert.equal(sessionHeat(12 * 60, true).heat_pct, 100);
  assert.equal(sessionHeat(15 * 60 + 10, true).state, "POWER_HOUR");
  assert.equal(sessionHeat(15 * 60 + 45, true).state, "LATE_SESSION");
  assert.equal(sessionHeat(16 * 60 + 1, true).state, "CLOSED");
});

test("heat: pre-market meter warms toward the open", () => {
  const early = sessionHeat(7 * 60, true).heat_pct; // 7:00 ET — before the ramp
  const late = sessionHeat(9 * 60 + 15, true).heat_pct; // 9:15 ET — nearly open
  assert.equal(early, 0);
  assert.ok(late > 25 && late <= 40);
});

// ── setup derivation ─────────────────────────────────────────────────────────────

function row(overrides: Partial<FlowSetupInput>): FlowSetupInput {
  return {
    ticker: "NVDA",
    premium: 600_000,
    option_type: "call",
    strike: 190,
    expiry: "2026-07-06",
    dte: 0,
    alert_rule: "RepeatedHitsAscendingFill",
    ask_pct: 70,
    underlying_price: 188.4,
    alerted_at: "2026-07-06T14:31:00Z",
    ...overrides,
  };
}

test("setups: one-sided 0DTE concentration produces a long setup with the dominant strike", () => {
  const rows = [
    row({ premium: 900_000, strike: 190 }),
    row({ premium: 700_000, strike: 190, alert_rule: "SweepsFollowedByFloor" }),
    row({ premium: 400_000, strike: 195 }),
  ];
  const out = deriveZeroDteSetups(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.ticker, "NVDA");
  assert.equal(out[0]!.direction, "long");
  assert.equal(out[0]!.top_strike, 190);
  assert.ok(out[0]!.score > 0);
});

test("setups: two-sided tape (no dominance) is NOT a setup", () => {
  const rows = [
    row({ premium: 1_000_000, option_type: "call" }),
    row({ premium: 900_000, option_type: "put", strike: 185 }),
  ];
  assert.equal(deriveZeroDteSetups(rows).length, 0);
});

test("setups: put-dominant tape produces a short setup", () => {
  const rows = [
    row({ premium: 1_200_000, option_type: "put", strike: 185 }),
    row({ premium: 300_000, option_type: "call" }),
  ];
  const out = deriveZeroDteSetups(rows);
  assert.equal(out[0]!.direction, "short");
  assert.equal(out[0]!.top_strike, 185);
});

test("setups: far-dated and thin tickers are excluded", () => {
  const rows = [
    row({ dte: 14 }), // not 0-1 DTE
    row({ ticker: "TINY", premium: 200_000 }), // below gross floor
  ];
  assert.equal(deriveZeroDteSetups(rows).length, 0);
});

test("setups: excluded tickers (SPX handled by its own engines) are skipped", () => {
  const rows = [row({ ticker: "SPY", premium: 2_000_000 })];
  assert.equal(deriveZeroDteSetups(rows, { excludeTickers: new Set(["SPY"]) }).length, 0);
});

test("setups: sudden flow spike flagged when ≥half the tape lands in the last 30m", () => {
  const now = Date.parse("2026-07-06T15:00:00Z");
  const spiky = [
    row({ premium: 300_000, alerted_at: "2026-07-06T09:40:00Z" }),
    row({ premium: 200_000, alerted_at: "2026-07-06T14:40:00Z" }),
    row({ premium: 400_000, alerted_at: "2026-07-06T14:50:00Z" }),
    row({ premium: 300_000, alerted_at: "2026-07-06T14:55:00Z" }),
  ];
  const out = deriveZeroDteSetups(spiky, { nowMs: now });
  assert.equal(out[0]!.spike, true);
  assert.equal(out[0]!.recent_premium_30m, 900_000);

  // Same premium spread across the morning — no spike.
  const drip = spiky.map((r, i) => ({ ...r, alerted_at: `2026-07-06T1${i}:00:00Z` }));
  assert.equal(deriveZeroDteSetups(drip, { nowMs: now })[0]!.spike, false);
});

test("setups: prints for contracts that expired a prior session are dropped", () => {
  const rows = [
    row({ premium: 2_000_000, expiry: "2026-07-02", dte: 0 }), // expired yesterday
    row({ premium: 500_000, expiry: "2026-07-06", dte: 0 }), // today — below gross floor alone
  ];
  assert.equal(deriveZeroDteSetups(rows, { todayYmd: "2026-07-06" }).length, 0);
  // Without the session guard the expired tape would have qualified.
  assert.equal(deriveZeroDteSetups(rows).length, 1);
});

test("setups: underlying price comes from the FRESHEST print, not the last row processed", () => {
  const rows = [
    row({ premium: 900_000, underlying_price: 188.0, alerted_at: "2026-07-06T14:55:00Z" }),
    // Lower-premium (later in a premium-ordered feed) but STALE print — must not win.
    row({ premium: 300_000, underlying_price: 181.0, alerted_at: "2026-07-06T09:35:00Z" }),
  ];
  assert.equal(deriveZeroDteSetups(rows)[0]!.underlying_price, 188.0);
});

// ── ledger grading ───────────────────────────────────────────────────────────────

test("ledger grade: signed by direction, hit = moved with the setup", () => {
  const long = computeLedgerGrade("long", 100, 103);
  assert.equal(long.move_pct, 3);
  assert.equal(long.direction_hit, true);
  const short = computeLedgerGrade("short", 100, 103);
  assert.equal(short.move_pct, -3);
  assert.equal(short.direction_hit, false);
  const shortWin = computeLedgerGrade("short", 100, 96.5);
  assert.equal(shortWin.move_pct, 3.5);
  assert.equal(shortWin.direction_hit, true);
});

test("ledger grade: missing flag price or close is ungradeable, never guessed", () => {
  assert.equal(computeLedgerGrade("long", null, 103).direction_hit, null);
  assert.equal(computeLedgerGrade("long", 100, null).move_pct, null);
});

// ── earnings + hot-news flags ────────────────────────────────────────────────────

test("earnings: only tickers reporting today/next session are flagged", () => {
  const flags = matchEarnings(
    [
      { ticker: "NVDA", when: "afterhours", report_date: "2026-07-06", expected_move_pct: 8.2 },
      { ticker: "KO", when: "premarket", report_date: "2026-07-14", expected_move_pct: 2.1 },
    ],
    { today: "2026-07-06", nextDay: "2026-07-07" }
  );
  assert.equal(flags.get("NVDA")?.expected_move_pct, 8.2);
  assert.equal(flags.has("KO"), false);
});

test("hot news: freshest headline within the window wins; stale ignored", () => {
  const now = Date.parse("2026-07-06T15:00:00Z");
  const flags = matchHotNews(
    [
      { title: "Old story", published: "2026-07-06T09:00:00Z", tickers: ["NVDA"] },
      { title: "Fresh upgrade", published: "2026-07-06T14:30:00Z", tickers: ["NVDA"], url: "https://x" },
    ],
    now
  );
  assert.equal(flags.get("NVDA")?.title, "Fresh upgrade");
  assert.equal(flags.get("NVDA")?.minutes_ago, 30);
});

// ── fib levels ───────────────────────────────────────────────────────────────────

test("fib: up-swing retracements sit below the high; golden is 61.8%", () => {
  const levels = computeFibLevels(100, 200, "up");
  assert.equal(levels.length, 5);
  // 61.8% retracement of a 100-200 up-swing = 200 - 100*0.618 = 138.2
  const golden = levels.find((l) => l.golden)!;
  assert.equal(Math.round(golden.price * 10) / 10, 138.2);
  for (const l of levels) assert.ok(l.price > 100 && l.price < 200);
});

test("fib: down-swing retracements sit above the low (short-the-pop)", () => {
  const levels = computeFibLevels(100, 200, "down");
  // 61.8% bounce of a 200→100 down-swing = 100 + 100*0.618 = 161.8
  assert.equal(Math.round(levels.find((l) => l.golden)!.price * 10) / 10, 161.8);
});

test("fib: degenerate swings produce no levels", () => {
  assert.equal(computeFibLevels(0, 200, "up").length, 0);
  assert.equal(computeFibLevels(200, 100, "up").length, 0);
});

test("fib note: price at a level is annotated; golden preferred over a closer non-golden", () => {
  const levels = computeFibLevels(100, 200, "up");
  // 50% level = 150, golden = 138.2. Price exactly at 150 → 50% note.
  const at50 = nearestFibNote(150, levels);
  assert.equal(at50?.label, "50%");
  // Price between golden (138.2) and 38.2% (161.8): at 138.5 both golden (0.22%)
  // qualifies; golden wins even though nothing else is close.
  const atGolden = nearestFibNote(138.5, levels, 0.35);
  assert.equal(atGolden?.golden, true);
  // Far from every level → null.
  assert.equal(nearestFibNote(120, levels), null);
});

// ── dossier enrichment ───────────────────────────────────────────────────────────

function baseSetup(overrides?: Partial<ZeroDteSetup>): ZeroDteSetup {
  return {
    ticker: "NVDA",
    direction: "long",
    top_strike: 190,
    expiry: "2026-07-06",
    dte: 0,
    net_premium: 1_500_000,
    gross_premium: 2_000_000,
    prints: 9,
    sweep_pct: 0.4,
    side_dominance: 0.85,
    underlying_price: 188.2,
    score: 72,
    top_strike_avg_fill: 4.2,
    recent_premium_30m: 0,
    spike: false,
    first_seen: "2026-07-06T13:45:00Z",
    last_seen: "2026-07-06T15:02:00Z",
    ...overrides,
  };
}

function fakeDossier(overrides?: Partial<SetupDossierView>): SetupDossierView {
  return {
    tech: {
      price: 188.2,
      trend: "uptrend",
      setup_tags: ["breakout", "ma-stack-bullish"],
      breakout_zones: ["190.00 (weekly high)"],
      support_levels: [186.5, 184.1, 179.9],
      resistance_levels: [190.2, 193.5, 175.0],
      weekly: { high: 195, low: 178 },
      prior_day: { high: 189, low: 184, close: 187.5 },
      rsi14: 61.2,
      rel_volume: 1.8,
      atr14: 4.2,
      vwap: 187.9,
    },
    dark_pool: { total_premium: 42_000_000, bias: "bullish" },
    flow_streak: { streak_days: 3, direction: "long" },
    price_target: "PT raised to $210 at Morgan Stanley",
    scored: {
      score: 78,
      direction: "long",
      conviction: "HIGH",
      flow_score: 30,
      tech_score: 18,
      pos_score: 10,
      news_score: 8,
      smart_money_score: 12,
      catalyst_flags: ["analyst PT raise"],
    },
    trading_halt: false,
    ...overrides,
  };
}

test("enrich: full dossier merges score, factors, technicals, streak, dark pool", () => {
  const e = enrichSetup(baseSetup(), fakeDossier());
  assert.equal(e.dossier_score, 78);
  assert.equal(e.conviction, "HIGH");
  assert.equal(e.direction_confirmed, true);
  assert.deepEqual(e.factor_breakdown, { flow: 30, tech: 18, positioning: 10, news: 8, smart_money: 12 });
  assert.equal(e.trend, "uptrend");
  assert.deepEqual(e.breakout_zones, ["190.00 (weekly high)"]);
  // Nearest structure around 188.2: two highest supports below, lowest resistances above
  // (the 175.0 "resistance" below price is filtered out).
  assert.deepEqual(e.key_supports, [186.5, 184.1]);
  assert.deepEqual(e.key_resistances, [190.2, 193.5]);
  assert.equal(e.vwap, 187.9);
  assert.equal(e.atr14, 4.2);
  assert.equal(e.streak_days, 3);
  assert.equal(e.dark_pool_bias, "bullish");
  assert.deepEqual(e.catalyst_flags, ["analyst PT raise"]);
  assert.equal(e.analyst_note, "PT raised to $210 at Morgan Stanley");
  assert.equal(e.halted, false);
  // No extras supplied → flags null.
  assert.equal(e.earnings, null);
  assert.equal(e.news_hot, null);
});

test("enrich: earnings + hot-news extras pass through", () => {
  const e = enrichSetup(baseSetup(), null, {
    earnings: { when: "afterhours", report_date: "2026-07-06", expected_move_pct: 8.2 },
    news_hot: { title: "Fresh upgrade", published: "2026-07-06T14:30:00Z", url: null, minutes_ago: 30 },
  });
  assert.equal(e.earnings?.when, "afterhours");
  assert.equal(e.news_hot?.title, "Fresh upgrade");
});

test("enrich: dossier direction disagreeing with the tape is flagged, not hidden", () => {
  const dossier = fakeDossier();
  dossier.scored = { ...dossier.scored!, direction: "short" };
  const e = enrichSetup(baseSetup(), dossier);
  assert.equal(e.direction_confirmed, false);
  assert.equal(e.dossier_score, 78); // score still surfaced — the UI shows the conflict
});

test("enrich: fib note computed from the weekly swing, oriented by setup direction", () => {
  // Long setup, weekly swing 178→195 (range 17). Golden dip-buy = 195 - 17*0.618 = 184.494.
  const dossier = fakeDossier();
  const e = enrichSetup(baseSetup({ underlying_price: 184.5 }), dossier);
  assert.ok(e.fib_note);
  assert.equal(e.fib_note!.golden, true);
  // Short setup retraces the down-swing instead: golden pop-short = 178 + 17*0.618 = 188.506.
  const s = enrichSetup(baseSetup({ direction: "short", underlying_price: 188.5 }), dossier);
  assert.ok(s.fib_note);
  assert.equal(s.fib_note!.golden, true);
});

test("enrich: null dossier degrades cleanly (base setup survives, enrichment fields null)", () => {
  const e = enrichSetup(baseSetup(), null);
  assert.equal(e.ticker, "NVDA");
  assert.equal(e.score, 72);
  assert.equal(e.dossier_score, null);
  assert.equal(e.direction_confirmed, null);
  assert.equal(e.factor_breakdown, null);
  assert.deepEqual(e.tech_tags, []);
  assert.equal(e.fib_note, null);
  assert.equal(e.halted, false);
});

test("enrich: trading halt is surfaced", () => {
  const e = enrichSetup(baseSetup(), fakeDossier({ trading_halt: true }));
  assert.equal(e.halted, true);
});

// ── engine ranking ───────────────────────────────────────────────────────────────

test("ranking: ACTIVE play leads; power hour outranks lotto only inside its window", () => {
  const cards = [
    { kind: "lotto" as const, state: "ARMED" as const },
    { kind: "power_hour" as const, state: "ARMED" as const },
    { kind: "spx_play" as const, state: "ACTIVE" as const },
  ];
  const normal = rankEngineCards(cards, false);
  assert.deepEqual(normal.map((c) => c.kind), ["spx_play", "lotto", "power_hour"]);
  const ph = rankEngineCards(cards, true);
  assert.deepEqual(ph.map((c) => c.kind), ["spx_play", "power_hour", "lotto"]);
});

// ── contract plans ───────────────────────────────────────────────────────────────

import { buildContractPlan, gradePlanFromBars } from "./plan";

test("setups: top-strike avg fill is premium-weighted from real prints", () => {
  const rows = [
    row({ premium: 900_000, strike: 190, fill_price: 4.0 }),
    row({ premium: 300_000, strike: 190, fill_price: 6.0 }),
  ];
  const out = deriveZeroDteSetups(rows);
  // (4.0*900k + 6.0*300k) / 1.2M = 4.5
  assert.equal(out[0]!.top_strike_avg_fill, 4.5);
});

test("plan: MOVED when the premium already ran past the flow's fill — the skip rule", () => {
  const base = {
    occ: "O:NVDA260702C00190000",
    direction: "long" as const,
    price: 188.2,
    flowAvgFill: 4.2,
    keySupports: [186.5, 184.1],
    keyResistances: [190.2, 193.5],
    vwap: 187.9,
  };
  const moved = buildContractPlan({ ...base, bid: 8.2, ask: 8.6, mark: 8.4 });
  assert.equal(moved.entry_status, "MOVED");
  assert.equal(moved.vs_flow_pct, 100);
  const inRange = buildContractPlan({ ...base, bid: 4.0, ask: 4.4, mark: 4.2 });
  assert.equal(inRange.entry_status, "IN_RANGE");
  assert.equal(inRange.entry_max, 4.2);
  assert.equal(inRange.stop_premium, 2.1);
  assert.equal(inRange.target_premium, 8.4);
  const cheaper = buildContractPlan({ ...base, bid: 3.3, ask: 3.5, mark: 3.4 });
  assert.equal(cheaper.entry_status, "CHEAPER");
});

test("plan: underlying anchors come from real structure, mirrored by direction", () => {
  const long = buildContractPlan({
    occ: "O:X", direction: "long", price: 188.2, flowAvgFill: 4.2,
    bid: 4, ask: 4.4, mark: 4.2,
    keySupports: [186.5, 184.1], keyResistances: [190.2, 193.5], vwap: 187.9,
  });
  assert.equal(long.underlying_target, 190.2);
  assert.equal(long.underlying_invalid, 186.5);
  const short = buildContractPlan({
    occ: "O:X", direction: "short", price: 188.2, flowAvgFill: 4.2,
    bid: 4, ask: 4.4, mark: 4.2,
    keySupports: [186.5, 184.1], keyResistances: [190.2, 193.5], vwap: 187.9,
  });
  assert.equal(short.underlying_target, 186.5);
  assert.equal(short.underlying_invalid, 190.2);
});

test("plan: no quote and no fill → NO plan is built by the scan (guard is upstream); no quote WITH fill → NO_QUOTE status", () => {
  const p = buildContractPlan({
    occ: "O:X", direction: "long", price: 100, flowAvgFill: 2.0,
    bid: null, ask: null, mark: null,
    keySupports: [], keyResistances: [], vwap: null,
  });
  assert.equal(p.entry_status, "NO_QUOTE");
  assert.equal(p.entry_max, 2.0); // falls back to the flow's real fill
});

// 14:30 UTC = 10:30 ET on 2026-07-06 (EDT) — helper for bar timestamps.
const T0 = Date.parse("2026-07-06T14:30:00Z");
const MIN = 60_000;
const bar = (i: number, h: number, l: number, c: number) => ({ t: T0 + i * MIN, h, l, c });

test("plan grade: target touch before stop → doubled at +100%", () => {
  const g = gradePlanFromBars([bar(0, 4.4, 4.0, 4.2), bar(1, 8.6, 4.1, 8.5)], 4.2, T0 - MIN);
  assert.equal(g.outcome, "doubled");
  assert.equal(g.pnl_pct, 100);
});

test("plan grade: stop touch → stopped at −50%; same-bar both-touch counts the stop", () => {
  const stopped = gradePlanFromBars([bar(0, 4.3, 2.0, 2.2)], 4.2, T0 - MIN);
  assert.equal(stopped.outcome, "stopped");
  assert.equal(stopped.pnl_pct, -50);
  // one bar touches BOTH 8.4 and 2.1 → conservative: stopped.
  const both = gradePlanFromBars([bar(0, 9.0, 2.0, 5.0)], 4.2, T0 - MIN);
  assert.equal(both.outcome, "stopped");
});

test("plan grade: neither level by 15:30 ET → time stop at last close in window", () => {
  // bars: 10:30 ET onward, closing at 4.62 (+10%); a late bar past 15:30 ET is ignored.
  const late = Date.parse("2026-07-06T19:45:00Z"); // 15:45 ET
  const g = gradePlanFromBars(
    [bar(0, 4.4, 4.0, 4.3), bar(1, 4.7, 4.2, 4.62), { t: late, h: 12, l: 1, c: 1 }],
    4.2,
    T0 - MIN
  );
  assert.equal(g.outcome, "time_stop");
  assert.equal(g.pnl_pct, 10);
});

test("plan grade: bars only BEFORE the flag → ungradeable, never graded on hindsight", () => {
  const g = gradePlanFromBars([bar(0, 9, 2, 5)], 4.2, T0 + 10 * MIN);
  assert.equal(g.outcome, "ungradeable");
});
