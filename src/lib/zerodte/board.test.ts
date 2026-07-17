import assert from "node:assert/strict";
import test from "node:test";
import {
  buildZeroDteAuditRow,
  computeLedgerGrade,
  sessionHeat,
  resolveFreshFindStatus,
  deriveZeroDteSetups,
  rankEngineCards,
  enrichSetup,
  matchEarnings,
  matchHotNews,
  polygonSpotTicker,
  SETUP_MIN_GROSS,
  SETUP_MIN_AGGR_SHARE,
  SETUP_MIN_DOMINANCE,
  SETUP_MAX_ITM_PCT,
  type FlowSetupInput,
  type SetupDossierView,
  type ZeroDteGateRejection,
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

// resolveFreshFindStatus: the SAME "no new plays after 15:00 ET" cutoff every
// consumer of a fresh (not-yet-ledgered) find must apply — shared by ZeroDteBoard.tsx's
// mergePlays() (the UI) and zerodte-service.ts's zeroDtePlaysForLargo() (Largo/BIE),
// which previously re-derived its own copy that skipped this cutoff entirely (FINDINGS.md).

test("resolveFreshFindStatus: WATCH during RTH with no moved/illiquid flags — NEVER OPEN (P0 one-way commit door)", () => {
  // Regression guard for the live P0: this used to return "OPEN" for a clean RTH
  // fresh find, so an UNCOMMITTED candidate rendered exactly like a live position
  // and then visibly regressed to a watch/SKIP card when the next scan tick's
  // re-derived plan/gate flapped (MOVED/illiquid/gate verdicts are recomputed from
  // scratch every ~5s board build). OPEN is reserved for committed ledger rows.
  assert.equal(resolveFreshFindStatus("RTH", false, false), "WATCH");
  assert.equal(resolveFreshFindStatus("OPENING_DRIVE", false, false), "WATCH");
});

test("resolveFreshFindStatus: SKIP once POWER_HOUR/LATE_SESSION/CLOSED starts — the entry cutoff", () => {
  assert.equal(resolveFreshFindStatus("POWER_HOUR", false, false), "SKIP");
  assert.equal(resolveFreshFindStatus("LATE_SESSION", false, false), "SKIP");
  assert.equal(resolveFreshFindStatus("CLOSED", false, false), "SKIP");
});

test("resolveFreshFindStatus: undefined heat state is treated as closed, not open by default", () => {
  assert.equal(resolveFreshFindStatus(undefined, false, false), "SKIP");
});

test("resolveFreshFindStatus: MOVED or illiquid always SKIP, even during RTH", () => {
  assert.equal(resolveFreshFindStatus("RTH", true, false), "SKIP");
  assert.equal(resolveFreshFindStatus("RTH", false, true), "SKIP");
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

test("setups: top strike is chosen by aggression-weighted premium, not raw dollar premium", () => {
  // Strike A: bigger RAW premium ($1M) but mostly SOLD/bid-side (ask_pct=20 -> weight 0.15
  // -> $150k weighted). Strike B: smaller raw premium ($900k) but almost entirely bought
  // AT THE ASK (ask_pct=90 -> weight 1 -> $900k weighted) — this is where the actual
  // buying conviction that makes "long" the winning direction lives. The old code picked
  // A (raw prem wins); the fix must pick B (aggression-weighted prem wins).
  const rows = [
    row({ premium: 1_000_000, strike: 190, ask_pct: 20 }),
    row({ premium: 900_000, strike: 195, ask_pct: 90 }),
  ];
  const out = deriveZeroDteSetups(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.direction, "long");
  assert.equal(
    out[0]!.top_strike,
    195,
    "top strike must be the one carrying the actual buying conviction, not the bigger raw print"
  );
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
    aggression: 0.8,
    otm_pct: 1.0,
    new_money: false,
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

import { buildContractPlan, gradePlanFromBars, resolveLedgerEntryPremium } from "./plan";

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

// resolveLedgerEntryPremium: the persisted entry_premium column MUST agree with
// entry_max (the plan's own "enter at or below" instruction, which stop_premium/
// target_premium are built from) — not the raw live mark. Otherwise the final
// grade (gradePlanFromBars) and live TRIM/stop tracking (derivePlayStatus) score
// a different trade than the one the member was actually told to make.

test("resolveLedgerEntryPremium: prefers the plan's entry_max over the flow fill (entry_max already IS flowAvgFill-preferred-over-mark)", () => {
  // A play flagged with a real flow fill of 2.00 but a live mark of 2.50 at flag
  // time — entry_max is 2.00 (member's actual instruction). entry_premium must
  // also be 2.00, not 2.50, or the persisted grade measures a trade nobody was
  // told to make.
  assert.equal(resolveLedgerEntryPremium(2.0, 2.0), 2.0);
});

test("resolveLedgerEntryPremium: falls back to the flow fill when there's no plan at all", () => {
  assert.equal(resolveLedgerEntryPremium(undefined, 3.5), 3.5);
  assert.equal(resolveLedgerEntryPremium(null, 3.5), 3.5);
});

test("resolveLedgerEntryPremium: null when neither a plan entry_max nor a flow fill exists — never fabricated", () => {
  assert.equal(resolveLedgerEntryPremium(null, null), null);
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

// ── live play lifecycle ──────────────────────────────────────────────────────────

import { derivePlayStatus, NEW_PLAY_CUTOFF_ET_MINUTES } from "./plan";

test("lifecycle: OPEN while enterable, HOLD past cutoff or above the band", () => {
  const base = { entryPremium: 4.2, peak: 4.2, trough: 4.2 };
  const open = derivePlayStatus({ ...base, mark: 4.1, nowEtMinutes: 11 * 60 });
  assert.equal(open.status, "OPEN");
  // Same mark after the 15:00 ET cutoff → no longer enterable.
  const held = derivePlayStatus({ ...base, mark: 4.1, nowEtMinutes: NEW_PLAY_CUTOFF_ET_MINUTES + 5 });
  assert.equal(held.status, "HOLD");
  // Mark well above the entry band intraday → HOLD (manage, don't add).
  const ran = derivePlayStatus({ ...base, mark: 5.5, peak: 5.5, nowEtMinutes: 11 * 60 });
  assert.equal(ran.status, "HOLD");
  assert.equal(ran.live_pnl_pct, 30.95);
});

test("lifecycle: a mark BELOW the entry band (but above the stop) is HOLD, not OPEN — the ADD-to-a-loser bug", () => {
  const base = { entryPremium: 4.2, peak: 4.2, trough: 4.2, nowEtMinutes: 11 * 60 };
  const insideBand = derivePlayStatus({ ...base, mark: 3.8 });
  assert.equal(insideBand.status, "OPEN");
  const belowBand = derivePlayStatus({ ...base, mark: 3.7, trough: 3.7 });
  assert.equal(belowBand.status, "HOLD");
  const liveCase = derivePlayStatus({
    entryPremium: 2.08,
    mark: 1.38,
    peak: 2.08,
    trough: 1.38,
    nowEtMinutes: 11 * 60,
  });
  assert.equal(liveCase.status, "HOLD");
  assert.equal(liveCase.live_pnl_pct, -33.65);
});

test("lifecycle: TRIM latches once the premium has doubled", () => {
  const s = derivePlayStatus({ entryPremium: 4.2, mark: 6.0, peak: 8.5, trough: 4.0, nowEtMinutes: 13 * 60 });
  assert.equal(s.status, "TRIM"); // peak tagged 2x even though mark pulled back
});

test("lifecycle: a touched stop stays CLOSED even if the premium bounces", () => {
  const s = derivePlayStatus({ entryPremium: 4.2, mark: 4.4, peak: 4.4, trough: 2.0, nowEtMinutes: 13 * 60 });
  assert.equal(s.status, "CLOSED");
  assert.equal(s.closed_reason, "stopped");
  assert.equal(s.live_pnl_pct, -50);
});

// P0 regression guard: peak/trough are latched extremes with no timestamp, so once
// BOTH have crossed their thresholds this function alone can't know which happened
// first. A play that legitimately doubled (peak >= target) and only later craters
// (trough <= stop, e.g. 0DTE theta collapse into the close) must stay a win — not
// retroactively become a stop-out just because the crash pushed the trough down
// after the fact. Mirrors gradePlanFromBars' chronological "first touch wins"
// standard the ledger grades every play against the next day.
test("lifecycle: a play that already doubled stays TRIM even after later crashing through the stop level", () => {
  // entry 4.2 -> target 8.4, stop 2.1. peak (8.5) already cleared target; trough
  // (1.5) has since also cleared stop — the crash-after-target scenario.
  const s = derivePlayStatus({ entryPremium: 4.2, mark: 1.6, peak: 8.5, trough: 1.5, nowEtMinutes: 15 * 60 });
  assert.equal(s.status, "TRIM", "target was hit first — a later crash must not flip this to a stop-out");
  assert.notEqual(s.closed_reason, "stopped");
});

test("lifecycle: a play that hits the stop WITHOUT ever reaching target still closes stopped", () => {
  // Sanity check for the same reorder: a genuine stop-first case (peak never
  // cleared target) must be unaffected by checking peak before trough.
  const s = derivePlayStatus({ entryPremium: 4.2, mark: 2.0, peak: 4.6, trough: 1.5, nowEtMinutes: 13 * 60 });
  assert.equal(s.status, "CLOSED");
  assert.equal(s.closed_reason, "stopped");
});

test("lifecycle: everything is CLOSED after the 15:30 ET hard exit", () => {
  const s = derivePlayStatus({ entryPremium: 4.2, mark: 4.8, peak: 4.8, trough: 4.0, nowEtMinutes: 15 * 60 + 31 });
  assert.equal(s.status, "CLOSED");
  assert.equal(s.closed_reason, "time_stop");
});

test("lifecycle: the hard exit closes rows with NO entry premium too (data quality never exempts the clock)", () => {
  const afterClose = derivePlayStatus({ entryPremium: null, mark: null, peak: null, trough: null, nowEtMinutes: 20 * 60 });
  assert.equal(afterClose.status, "CLOSED");
  assert.equal(afterClose.closed_reason, "time_stop");
  // Same row during the session: HOLD (nothing to price against yet).
  const intraday = derivePlayStatus({ entryPremium: null, mark: null, peak: null, trough: null, nowEtMinutes: 12 * 60 });
  assert.equal(intraday.status, "HOLD");
});

// ── conviction gates (money-printing filter) ─────────────────────────────────────

test("gates: SOLD premium (bid-side prints) does not create a directional setup", () => {
  // $2M of puts sold at the bid — income harvesting, not a short signal.
  const rows = [
    row({ premium: 1_200_000, option_type: "put", strike: 185, ask_pct: 10 }),
    row({ premium: 800_000, option_type: "put", strike: 180, ask_pct: 15 }),
  ];
  assert.equal(deriveZeroDteSetups(rows).length, 0);
  // The same tape bought AT THE ASK is a real short setup.
  const bought = rows.map((r) => ({ ...r, ask_pct: 80 }));
  const out = deriveZeroDteSetups(bought);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.direction, "short");
  assert.ok(out[0]!.aggression! >= 0.9);
});

test("gates: aggressive side wins the direction even when raw premium says otherwise", () => {
  // $1.5M calls SOLD at the bid vs $900k puts BOUGHT at the ask → short, not long.
  const rows = [
    row({ premium: 1_500_000, option_type: "call", strike: 190, ask_pct: 10 }),
    row({ premium: 900_000, option_type: "put", strike: 185, ask_pct: 85 }),
  ];
  const out = deriveZeroDteSetups(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.direction, "short");
});

test("gates: unknown aggression (null ask_pct) is credited BELOW near-the-ask, not above it", () => {
  // Two tapes identical except ask_pct: one null (missing metadata), one 50% (near-ask).
  // The null tape's aggression should be LOWER because unknown is not evidence of conviction.
  const nullTape = [row({ premium: 1_500_000, option_type: "call", strike: 190, ask_pct: null as unknown as number })];
  const nearTape = [row({ premium: 1_500_000, option_type: "call", strike: 190, ask_pct: 50 })];
  const [nullOut] = deriveZeroDteSetups(nullTape);
  const [nearOut] = deriveZeroDteSetups(nearTape);
  // Both may or may not clear the gate, but the null tape's aggression must be ≤ near-ask's.
  if (nullOut && nearOut) {
    assert.ok(nullOut.aggression! <= nearOut.aggression!, `null aggr ${nullOut.aggression} should be <= near-ask aggr ${nearOut.aggression}`);
  }
});

test("gates: deep-ITM top strike (stock replacement) is excluded", () => {
  // 1880 put with the stock at 1723 — 9% ITM. Not a directional 0DTE bet.
  const rows = [row({ premium: 3_000_000, option_type: "put", strike: 1880, underlying_price: 1723 })];
  assert.equal(deriveZeroDteSetups(rows).length, 0);
  // Same size slightly OTM passes.
  const otm = [row({ premium: 3_000_000, option_type: "put", strike: 1700, underlying_price: 1723 })];
  assert.equal(deriveZeroDteSetups(otm).length, 1);
  assert.ok(deriveZeroDteSetups(otm)[0]!.otm_pct! > 0);
});

test("gates: missing underlying price fails CLOSED, not open — P0 regression guard", () => {
  // Same deep-ITM shape as the test above (1880 put, stock effectively at 1723 —
  // 9% ITM) but the tape never carried a usable underlying price for this ticker
  // (every UW field the extractor checks — underlying_last/underlying_price/
  // stock_price — came back missing/invalid). Before the fix, deriveZeroDteSetups
  // silently SKIPPED the whole moneyness gate in this case and let the candidate
  // through with otm_pct: null — a real stock-replacement fake-out would have
  // reached the live board completely ungated. It must now be rejected instead.
  const rows = [
    row({ premium: 3_000_000, option_type: "put", strike: 1880, underlying_price: undefined }),
  ];
  const rejections: ZeroDteGateRejection[] = [];
  const out = deriveZeroDteSetups(rows, { rejections });
  assert.equal(out.length, 0, "a candidate with no underlying price must not reach the board");
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0]!.gate_failed, "no_underlying_price");
  assert.equal(rejections[0]!.otm_pct, null, "otm_pct was never computed — must not be guessed");

  // A perfectly healthy, non-ITM candidate with a real underlying price is
  // unaffected by this gate — proves the fix didn't turn into a blanket reject.
  const healthy = [row({ premium: 3_000_000, option_type: "put", strike: 1700, underlying_price: 1723 })];
  assert.equal(deriveZeroDteSetups(healthy).length, 1);
});

test("audit row: max_itm_pct check fails closed on a null otm_pct reading (defense in depth)", () => {
  const rows = [row({ premium: 900_000, strike: 190 }), row({ premium: 700_000, strike: 190 })];
  const setup = deriveZeroDteSetups(rows)[0]!;
  const enriched = enrichSetup(setup, null);
  enriched.otm_pct = null; // simulate a bad invariant even though the gate now prevents this upstream
  const audit = buildZeroDteAuditRow(enriched, "2026-07-06");
  const itm = audit.decision_trace.find((c) => c.check === "max_itm_pct");
  assert.ok(itm);
  assert.equal(itm!.passed, false, "a null otm_pct must never be recorded as a passed check");
});

test("gates: new-money flag when implied contracts exceed the strike's OI", () => {
  const rows = [
    row({ premium: 2_000_000, fill_price: 2.0, open_interest: 5_000 }), // 10k contracts vs 5k OI
  ];
  const out = deriveZeroDteSetups(rows);
  assert.equal(out[0]!.new_money, true);
});

// ── gate-rejection / near-miss capture (task #147) ──────────────────────────────
// opts.rejections is an optional accumulator deriveZeroDteSetups pushes into at the
// exact point each of the 4 real gates (plus the structural no-top-strike guard)
// `continue`s past a candidate — see board.ts's module doc above the type. These
// tests assert the near-miss row carries only the metrics the real scan actually
// computed before short-circuiting (later-gate fields stay null, never guessed).

test("rejections: omitted opts.rejections — deriveZeroDteSetups behaves identically (no-op, no allocation)", () => {
  // Every OTHER test in this file calls deriveZeroDteSetups without opts.rejections
  // at all and already proves the return value is unaffected; this test just makes
  // the "no rejections array supplied" no-op explicit for a rejecting candidate.
  const rows = [row({ ticker: "TINY", premium: 200_000 })];
  assert.equal(deriveZeroDteSetups(rows).length, 0);
});

test("rejections: gross-premium gate failure — only gross_premium/prints known, everything gate-B-onward is null", () => {
  const rejections: ZeroDteGateRejection[] = [];
  const rows = [row({ ticker: "TINY", premium: 200_000, alerted_at: "2026-07-06T14:00:00Z" })];
  const out = deriveZeroDteSetups(rows, { rejections });

  assert.equal(out.length, 0, "TINY must not appear in setups");
  assert.equal(rejections.length, 1);
  const r = rejections[0]!;
  assert.equal(r.ticker, "TINY");
  assert.equal(r.gate_failed, "min_gross");
  assert.equal(r.threshold, SETUP_MIN_GROSS);
  assert.equal(r.gross_premium, 200_000);
  assert.equal(r.prints, 1);
  // The scan never reaches the aggression/dominance/otm gates for this candidate —
  // the real code never computes these values either, so they must be null, not 0
  // or a guessed number.
  assert.equal(r.aggression, null);
  assert.equal(r.side_dominance, null);
  assert.equal(r.otm_pct, null);
  assert.equal(r.direction, null);
});

test("rejections: aggression-share gate failure — gross known, aggression known, dominance/otm/direction still null", () => {
  const rejections: ZeroDteGateRejection[] = [];
  // Single-sided bid-heavy tape: passes the gross floor but the whole tape traded
  // well off the ask (aggressionWeight(10) = 0.15), well under SETUP_MIN_AGGR_SHARE.
  const rows = [row({ premium: 900_000, ask_pct: 10 })];
  const out = deriveZeroDteSetups(rows, { rejections });

  assert.equal(out.length, 0);
  assert.equal(rejections.length, 1);
  const r = rejections[0]!;
  assert.equal(r.gate_failed, "min_aggr_share");
  assert.equal(r.threshold, SETUP_MIN_AGGR_SHARE);
  assert.equal(r.gross_premium, 900_000);
  assert.equal(r.aggression, 0.15);
  // dominantCall is never computed for an aggression-gate rejection — the real
  // scan doesn't know a direction at this point either.
  assert.equal(r.side_dominance, null);
  assert.equal(r.otm_pct, null);
  assert.equal(r.direction, null);
});

test("rejections: dominance gate failure — direction/side_dominance now known, otm still null", () => {
  const rejections: ZeroDteGateRejection[] = [];
  // Both sides bought aggressively (ask_pct 70 -> full aggression weight) but close
  // to even — dominance ~0.56, under SETUP_MIN_DOMINANCE (0.65).
  const rows = [
    row({ premium: 500_000, option_type: "call", strike: 190, ask_pct: 70 }),
    row({ premium: 400_000, option_type: "put", strike: 185, ask_pct: 70 }),
  ];
  const out = deriveZeroDteSetups(rows, { rejections });

  assert.equal(out.length, 0);
  assert.equal(rejections.length, 1);
  const r = rejections[0]!;
  assert.equal(r.gate_failed, "min_dominance");
  assert.equal(r.threshold, SETUP_MIN_DOMINANCE);
  assert.equal(r.gross_premium, 900_000);
  assert.equal(r.aggression, 1);
  assert.equal(r.direction, "long"); // calls narrowly lead (500k vs 400k)
  assert.ok(r.side_dominance! > 0.5 && r.side_dominance! < SETUP_MIN_DOMINANCE);
  assert.equal(r.otm_pct, null, "the scan never reaches the moneyness gate for a dominance rejection");
});

test("rejections: moneyness (max_itm_pct) gate failure — every earlier-gate metric populated, otm_pct real and negative", () => {
  const rejections: ZeroDteGateRejection[] = [];
  // Same deep-ITM fixture as the "gates: deep-ITM top strike" test above — 1880 put
  // with the stock at 1723 (~9.1% ITM), well past SETUP_MAX_ITM_PCT (2%).
  const rows = [row({ premium: 3_000_000, option_type: "put", strike: 1880, underlying_price: 1723 })];
  const out = deriveZeroDteSetups(rows, { rejections });

  assert.equal(out.length, 0);
  assert.equal(rejections.length, 1);
  const r = rejections[0]!;
  assert.equal(r.gate_failed, "max_itm_pct");
  assert.equal(r.threshold, -SETUP_MAX_ITM_PCT);
  assert.equal(r.gross_premium, 3_000_000);
  assert.equal(r.direction, "short");
  assert.ok(r.aggression! > 0);
  assert.ok(r.side_dominance! >= SETUP_MIN_DOMINANCE);
  assert.ok(r.otm_pct! < -SETUP_MAX_ITM_PCT, "otm_pct must be the real negative reading, not a guess");
});

test("rejections: a candidate that clears every gate does NOT also get a near-miss row (it already has its own committed-setup record)", () => {
  const rejections: ZeroDteGateRejection[] = [];
  const rows = [
    row({ premium: 900_000, strike: 190 }),
    row({ premium: 700_000, strike: 190, alert_rule: "SweepsFollowedByFloor" }),
    row({ premium: 400_000, strike: 195 }),
  ];
  const out = deriveZeroDteSetups(rows, { rejections });

  assert.equal(out.length, 1, "NVDA should clear every gate and appear in setups");
  assert.equal(rejections.length, 0, "a fully-qualifying candidate must not ALSO log a near-miss row");
});

test("rejections: a mixed batch only logs the ticker that actually failed a gate", () => {
  const rejections: ZeroDteGateRejection[] = [];
  const rows = [
    // NVDA clears every gate.
    row({ ticker: "NVDA", premium: 900_000, strike: 190 }),
    row({ ticker: "NVDA", premium: 700_000, strike: 190, alert_rule: "SweepsFollowedByFloor" }),
    // TINY fails the gross-premium floor.
    row({ ticker: "TINY", premium: 200_000 }),
  ];
  const out = deriveZeroDteSetups(rows, { rejections });

  assert.deepEqual(out.map((s) => s.ticker), ["NVDA"]);
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0]!.ticker, "TINY");
  assert.equal(rejections[0]!.gate_failed, "min_gross");
});

// ── intel notes ──────────────────────────────────────────────────────────────────

import { buildIntelNote } from "./intel";

test("intel: OPEN play says ADD with entry/stop numbers from the plan", () => {
  const s = enrichSetup(baseSetup(), fakeDossier());
  s.plan = {
    occ: "O:NVDA260706C00190000", flow_avg_fill: 4.2, bid: 4.0, ask: 4.4, mark: 4.2,
    entry_max: 4.2, vs_flow_pct: 0, entry_status: "IN_RANGE", spread_pct: 9.5, illiquid: false,
    stop_premium: 2.1, target_premium: 8.4, time_stop_et: "15:30",
    underlying_target: 190.2, underlying_invalid: 186.5,
  };
  const note = buildIntelNote({ status: "OPEN", setup: s, plan: s.plan, entryPremium: 4.2, livePnlPct: null, planOutcome: null, planPnlPct: null });
  assert.equal(note.action, "ADD");
  assert.match(note.reason, /Enter ≤ \$4\.20/);
  assert.match(note.reason, /stop \$2\.10/);
});

test("intel: WATCH (uncommitted fresh find) never says ADD or 'Enter ≤' — candidate language only", () => {
  // P0 pre-commit honesty: the fresh-find lane used to feed status "OPEN" here,
  // which produced action:"ADD" with a live entry instruction for a play the desk
  // had NOT committed. WATCH must read as a candidate, never an actionable entry.
  const s = enrichSetup(baseSetup(), fakeDossier());
  const note = buildIntelNote({ status: "WATCH", setup: s, plan: s.plan, entryPremium: 4.2, livePnlPct: null, planOutcome: null, planPnlPct: null });
  assert.equal(note.action, "WATCH");
  assert.doesNotMatch(note.reason, /Enter ≤/);
  assert.match(note.reason, /NOT committed/);
  assert.match(note.reason, /do not enter/i);
});

test("intel: illiquid market is a PASS with the spread named", () => {
  const note = buildIntelNote({
    status: "SKIP", setup: null,
    plan: { occ: "O:X", flow_avg_fill: 2, bid: 1.5, ask: 2.5, mark: 2, entry_max: 2, vs_flow_pct: 0, entry_status: "IN_RANGE", spread_pct: 50, illiquid: true, stop_premium: 1, target_premium: 4, time_stop_et: "15:30", underlying_target: null, underlying_invalid: null },
    entryPremium: 2, livePnlPct: null, planOutcome: null, planPnlPct: null,
  });
  assert.equal(note.action, "PASS");
  assert.match(note.reason, /spread is 50%/);
});

test("intel: TRIM and stop-out SELL read like a desk, with the numbers", () => {
  const trim = buildIntelNote({ status: "TRIM", setup: null, plan: null, entryPremium: 4.2, livePnlPct: 105, planOutcome: null, planPnlPct: null });
  assert.equal(trim.action, "TRIM");
  assert.match(trim.reason, /\+100%/);
  const stopped = buildIntelNote({ status: "CLOSED", setup: null, plan: null, entryPremium: 4.2, livePnlPct: -50, planOutcome: "stopped", planPnlPct: -50 });
  assert.equal(stopped.action, "SELL");
  assert.match(stopped.reason, /Stopped at −50%/);
});

test("intel: TRIM after the peak already reversed into a loss doesn't tell the member to 'bank it'", () => {
  // TRIM is sticky once peak >= target (derivePlayStatus, plan.ts) so a play that doubled
  // then fully round-tripped stays TRIM rather than getting relabeled a stop-out — but the
  // narrative must stop claiming the double is still live once livePnlPct has actually gone
  // negative. Matches the real production pattern: QQQ/SPXW peaked past +100% intraday then
  // collapsed to -84.71%/-47.06% while still tagged TRIM.
  const note = buildIntelNote({ status: "TRIM", setup: null, plan: null, entryPremium: 1.57, livePnlPct: -84.71, planOutcome: null, planPnlPct: null });
  assert.equal(note.action, "TRIM");
  assert.doesNotMatch(note.reason, /bank at least half/);
  assert.doesNotMatch(note.reason, /never let a double go red/);
  assert.match(note.reason, /gave it back/);
  assert.match(note.reason, /-85%/);
});

// ── intraday edge layer ──────────────────────────────────────────────────────────

import {
  computeIntradayRead,
  intradayScoreAdjust,
  marketAlignAdjust,
  marketBias,
  timeOfDayFactor,
  type IntradayBar,
} from "./intraday";

// 2026-07-06 is EDT: 13:30 UTC = 9:30 ET.
const OPEN_MS = Date.parse("2026-07-06T13:30:00Z");
const M = 60_000;
const ibar = (minAfterOpen: number, px: number, v = 100): IntradayBar => ({
  t: OPEN_MS + minAfterOpen * M,
  h: px + 0.5,
  l: px - 0.5,
  c: px,
  v,
});

test("intraday: VWAP, opening range and 5m trend from minute bars", () => {
  const bars = [
    ...Array.from({ length: 30 }, (_, i) => ibar(i, 100)), // OR: ~99.5-100.5
    ...Array.from({ length: 60 }, (_, i) => ibar(30 + i, 100 + i * 0.05)), // grind up to ~103
  ];
  const read = computeIntradayRead(bars);
  assert.ok(read.vwap != null && read.vwap > 100 && read.vwap < 103);
  assert.equal(read.or_high, 100.5);
  assert.equal(read.or_break, "above"); // last ~102.95 > OR high
  assert.equal(read.trend_5m, "up");
  assert.ok(read.vwap_dist_pct! > 0);
});

test("intraday: pre-market-only bars produce nulls, never a guess", () => {
  const pre = [{ t: OPEN_MS - 60 * M, h: 101, l: 99, c: 100, v: 50 }];
  const read = computeIntradayRead(pre);
  assert.equal(read.vwap, null);
  assert.equal(read.or_break, null);
});

test("intraday adjust: confirmation adds, hard conflict flags", () => {
  const up = computeIntradayRead([
    ...Array.from({ length: 30 }, (_, i) => ibar(i, 100)),
    ...Array.from({ length: 60 }, (_, i) => ibar(30 + i, 100 + i * 0.05)),
  ]);
  const confirmLong = intradayScoreAdjust("long", up);
  assert.ok(confirmLong.delta > 0);
  assert.equal(confirmLong.conflict, false);
  // A short against price above VWAP with an up trend = hard conflict.
  const fightShort = intradayScoreAdjust("short", up);
  assert.ok(fightShort.delta < 0);
  assert.equal(fightShort.conflict, true);
});

test("market alignment: with SPY +4, against −6; flat/unknown 0", () => {
  const up = computeIntradayRead([
    ...Array.from({ length: 30 }, (_, i) => ibar(i, 100)),
    ...Array.from({ length: 60 }, (_, i) => ibar(30 + i, 100 + i * 0.05)),
  ]);
  const bias = marketBias(up);
  assert.equal(bias, "up");
  assert.equal(marketAlignAdjust("long", bias), 4);
  assert.equal(marketAlignAdjust("short", bias), -6);
  assert.equal(marketAlignAdjust("long", null), 0);
});

test("time of day: prime windows reward, lunch chop penalizes", () => {
  assert.ok(timeOfDayFactor(9 * 60 + 40).delta < 0); // opening chop
  assert.ok(timeOfDayFactor(10 * 60 + 15).delta > 0); // prime morning
  assert.ok(timeOfDayFactor(12 * 60).delta < 0); // lunch chop
  assert.match(timeOfDayFactor(12 * 60).label ?? "", /lunch chop/);
  assert.ok(timeOfDayFactor(14 * 60 + 30).delta > 0); // afternoon trend window
});

// ── BlackOut Intelligence: live dynamics ─────────────────────────────────────────

test("intel: HOLD carries live trigger distances and the exit countdown", () => {
  const note = buildIntelNote({
    status: "HOLD", setup: null, plan: null,
    entryPremium: 4.0, livePnlPct: 30, planOutcome: null, planPnlPct: null,
    nowEtMinutes: 14 * 60, lastMark: 5.2,
  });
  assert.equal(note.action, "HOLD");
  assert.match(note.reason, /\$2\.80 below the trim/); // 8.00 target − 5.20 mark
  assert.match(note.reason, /\$3\.20 above the stop/); // 5.20 mark − 2.00 stop
  assert.match(note.reason, /90m to the 3:30 hard exit/);
});

test("intel: ADD shows the entry-window countdown when inside 90 minutes", () => {
  const note = buildIntelNote({
    status: "OPEN", setup: null, plan: null,
    entryPremium: 4.0, livePnlPct: null, planOutcome: null, planPnlPct: null,
    nowEtMinutes: 14 * 60 + 20, lastMark: 4.0,
  });
  assert.match(note.reason, /40m left in the entry window/);
});

// ── Stage 4 audit trail (buildZeroDteAuditRow) ────────────────────────────────────
// Fixture-driven, no database required — the same pattern the rest of this file
// uses for board.ts's other pure functions.

test("audit row: cites the real gate values/thresholds, all passed (setup already cleared them)", () => {
  const rows = [
    row({ premium: 900_000, strike: 190 }),
    row({ premium: 700_000, strike: 190, alert_rule: "SweepsFollowedByFloor" }),
    row({ premium: 400_000, strike: 195 }),
  ];
  const setup = deriveZeroDteSetups(rows)[0]!;
  const enriched = enrichSetup(setup, null);
  const audit = buildZeroDteAuditRow(enriched, "2026-07-06");

  assert.equal(audit.alert_type, "zerodte");
  assert.equal(audit.source_table, "zerodte_setup_log");
  assert.deepEqual(audit.source_key, { session_date: "2026-07-06", ticker: "NVDA" });
  assert.equal(audit.ticker, "NVDA");
  assert.equal(audit.direction, "long");
  assert.equal(audit.trigger_reason, "dominant aggressor flow");
  assert.equal(audit.decision_trace.length, 5);
  for (const check of audit.decision_trace) {
    assert.equal(check.passed, true, `expected ${check.check} to have passed`);
  }
  // No dossier / no live quote in this fixture → no plan yet.
  assert.equal(audit.final_output, null);
});

test("audit row: trigger_reason reflects an actual flow spike", () => {
  const now = Date.parse("2026-07-06T15:00:00Z");
  const spiky = [
    row({ premium: 300_000, alerted_at: "2026-07-06T09:40:00Z" }),
    row({ premium: 200_000, alerted_at: "2026-07-06T14:40:00Z" }),
    row({ premium: 400_000, alerted_at: "2026-07-06T14:50:00Z" }),
    row({ premium: 300_000, alerted_at: "2026-07-06T14:55:00Z" }),
  ];
  const setup = deriveZeroDteSetups(spiky, { nowMs: now })[0]!;
  const enriched = enrichSetup(setup, null);
  const audit = buildZeroDteAuditRow(enriched, "2026-07-06");
  assert.equal(audit.trigger_reason, "flow spike (30m surge)");
});

test("audit row: confidence_score prefers the full dossier score over the raw evidence score", () => {
  const rows = [row({ premium: 900_000, strike: 190 }), row({ premium: 700_000, strike: 190 })];
  const setup = deriveZeroDteSetups(rows)[0]!;
  const noDossier = buildZeroDteAuditRow(enrichSetup(setup, null), "2026-07-06");
  assert.equal(noDossier.confidence_score, setup.score);

  const dossier: SetupDossierView = {
    scored: {
      score: 88, direction: "long", conviction: "very strong",
      flow_score: 30, tech_score: 20, pos_score: 15, news_score: 10, smart_money_score: 13,
    },
  };
  const withDossier = buildZeroDteAuditRow(enrichSetup(setup, dossier), "2026-07-06");
  assert.equal(withDossier.confidence_score, 88);
  assert.equal(withDossier.confidence_label, "very strong");
});

test("audit row: intraday_conflict gate recorded and fails when conflict is true", () => {
  const rows = [row({ premium: 900_000, strike: 190 }), row({ premium: 700_000, strike: 190 })];
  const setup = deriveZeroDteSetups(rows)[0]!;
  const enriched = enrichSetup(setup, null);
  enriched.intraday_conflict = true;
  const audit = buildZeroDteAuditRow(enriched, "2026-07-06");
  const conflict = audit.decision_trace.find((c) => c.check === "intraday_conflict");
  assert.ok(conflict);
  assert.equal(conflict!.passed, false);
  assert.equal(conflict!.value, true);
});

// ── polygonSpotTicker (index-root → I: namespace mapping) ─────────────────────────
// Live-verified 2026-07-13: Polygon /v2/aggs for "SPXW"/"SPX"/"NDX" returns status
// OK with resultsCount 0 (no throw), while "I:SPX"/"I:NDX" return real bars — so an
// unmapped index-root ledger row was stamped graded with a permanent null direction
// grade, and its intraday read silently degraded to nulls.

test("polygonSpotTicker: index option roots map to the I: index namespace", () => {
  assert.equal(polygonSpotTicker("SPXW"), "I:SPX");
  assert.equal(polygonSpotTicker("SPX"), "I:SPX");
  assert.equal(polygonSpotTicker("NDX"), "I:NDX");
  assert.equal(polygonSpotTicker("NDXP"), "I:NDX");
  assert.equal(polygonSpotTicker("RUT"), "I:RUT");
  assert.equal(polygonSpotTicker("VIX"), "I:VIX");
});

test("polygonSpotTicker: equities and ETF wrappers pass through unchanged (case-normalized)", () => {
  assert.equal(polygonSpotTicker("NVDA"), "NVDA");
  assert.equal(polygonSpotTicker("SPY"), "SPY"); // ETF, real equity aggs — must NOT map
  assert.equal(polygonSpotTicker("QQQ"), "QQQ");
  assert.equal(polygonSpotTicker("spxw"), "I:SPX");
  assert.equal(polygonSpotTicker("meta"), "META");
});
