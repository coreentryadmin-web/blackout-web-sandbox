// PR-N10 — the Debrief: per-play post-mortem tests. Hermetic and pure: fixture rows +
// bars in, deterministic debriefs out. The two anchor fixtures are REAL plays from the
// product's own history (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §2 forensics /
// nh-overnight/derived.json): AMD 2026-07-07 (the record's only A+, gapped −6.55%
// through its stop pre-open) and DELL 2026-07-08 (band $226.82–227.27 vs a $417 stock —
// the N-3 detached-band class). Every taxonomy tag is exercised in BOTH directions.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEBRIEF_VERSION,
  LUCKY_WIN_MAE_STOP_FRACTION,
  computeExcursion,
  computeFill,
  debriefPlay,
  fillEdgeOf,
  pulledPlayWouldHaveWon,
  readDebriefPin,
  sessionBarFromRow,
  type DebriefRowLike,
} from "./debrief";
import { GATE_BAND_MAX_DISTANCE_PCT } from "./publish-gates";
import { GRADE_METHODOLOGY_CURRENT } from "./grade-methodology";

// ── Fixtures ─────────────────────────────────────────────────────────────────────────

function row(over: Partial<DebriefRowLike> = {}): DebriefRowLike {
  return {
    edition_for: "2026-07-14",
    ticker: "TEST",
    direction: "LONG",
    conviction: "B",
    entry_range_low: 100,
    entry_range_high: 102,
    target: 110,
    stop: 95,
    next_day_open: 101,
    next_day_close: 105,
    session_high: 108,
    session_low: 100,
    outcome: "open",
    pulled: false,
    pulled_reason: null,
    publish_context: null,
    morning_verdict: null,
    grade_methodology: GRADE_METHODOLOGY_CURRENT,
    ...over,
  };
}

/** AMD 2026-07-07 (real history): LONG 550–556 band, target 562.99, stop 550.88;
 *  session o 515.91 / h 524.97 / l 503.11 / c 516.11 — graded stop. */
const AMD_0707 = row({
  ticker: "AMD",
  edition_for: "2026-07-07",
  conviction: "A+",
  entry_range_low: 550,
  entry_range_high: 555,
  target: 562.99,
  stop: 550.88,
  next_day_open: 515.91,
  next_day_close: 516.11,
  session_high: 524.97,
  session_low: 503.11,
  outcome: "stop",
});

/** DELL 2026-07-08 (real history): LONG band 226.82–227.27 with the stock at $417 —
 *  session o 422.88 / h 449.45 / l 414 / c 431.97 — graded unfilled (N-3 class). */
const DELL_0708 = row({
  ticker: "DELL",
  edition_for: "2026-07-08",
  conviction: "A",
  entry_range_low: 226.82,
  entry_range_high: 227.27,
  target: 469.47,
  stop: 225,
  next_day_open: 422.88,
  next_day_close: 431.97,
  session_high: 449.45,
  session_low: 414,
  outcome: "unfilled",
});

const PIN = {
  context_version: 2,
  pinned_at: "2026-07-13T23:45:00Z",
  spot_at_publish: 101.5,
  prior_close: 101.2,
  atr14: 3.5,
  band_distance_pct: 0.49,
  market: { composite_regime: "BULLISH risk-on", tide_bias: "bullish" },
  catalysts: { earnings_tomorrow: false, earnings_risk: false, catalyst_flags: [] },
};

// ── Taxonomy: wins ───────────────────────────────────────────────────────────────────

test("clean_win LONG: filled, target hit, drawdown well inside the stop budget", () => {
  const d = debriefPlay(
    row({ outcome: "target", next_day_open: 101, session_high: 111, session_low: 100.5, next_day_close: 110.5 })
  )!;
  assert.equal(d.failure_mode.tag, "clean_win");
  assert.equal(d.fill.filled, true);
  assert.equal(d.fill.first_touch, "open");
  // entry = the open 101 (inside the band, fills at the open); MAE = (100.5-101)/101 = -0.5
  assert.equal(d.excursion!.entry, 101);
  assert.equal(d.excursion!.mae_pct, -0.5);
  assert.ok(d.excursion!.mae_vs_stop_ratio! < LUCKY_WIN_MAE_STOP_FRACTION);
});

test("clean_win SHORT: mirrored math", () => {
  const d = debriefPlay(
    row({
      direction: "SHORT",
      target: 92,
      stop: 105,
      next_day_open: 99.5,
      session_high: 100.6,
      session_low: 91,
      next_day_close: 92.5,
      outcome: "target",
    })
  )!;
  assert.equal(d.failure_mode.tag, "clean_win");
  // SHORT entry = band low 100; MFE = (100-91)/100 = 9%; MAE = (100-100.6)/100 = -0.6%
  assert.equal(d.excursion!.entry, 100);
  assert.equal(d.excursion!.mfe_pct, 9);
  assert.equal(d.excursion!.mae_pct, -0.6);
});

test("lucky_win: a target grade that first consumed most of the stop distance is never a clean win", () => {
  const d = debriefPlay(
    row({ outcome: "target", next_day_open: 101, session_high: 111, session_low: 95.5, next_day_close: 110 })
  )!;
  // MAE = (95.5-102)/102 = -6.37%; stop distance = -6.86% → ratio ~0.93 >= 0.75
  assert.equal(d.failure_mode.tag, "lucky_win");
  assert.ok(d.excursion!.mae_vs_stop_ratio! >= LUCKY_WIN_MAE_STOP_FRACTION);
  assert.match(d.failure_mode.detail, /stop distance/);
  assert.match(d.failure_mode.detail, /unknowable/); // the single-bar conservatism is stated
});

test("lucky_win SHORT: mirrored", () => {
  const d = debriefPlay(
    row({
      direction: "SHORT",
      target: 92,
      stop: 105,
      next_day_open: 100,
      session_high: 104.2, // MAE = -4.2% vs stop dist -5% → ratio 0.84
      session_low: 91,
      next_day_close: 93,
      outcome: "target",
    })
  )!;
  assert.equal(d.failure_mode.tag, "lucky_win");
});

test("gap_win: open already beyond target (legacy taxonomy — impossible under v2 grades)", () => {
  const long = debriefPlay(
    row({ outcome: "target", next_day_open: 111, session_high: 115, session_low: 100, next_day_close: 112 })
  )!;
  assert.equal(long.failure_mode.tag, "gap_win");
  assert.match(long.failure_mode.detail, /legacy/);
  const short = debriefPlay(
    row({
      direction: "SHORT",
      target: 92,
      stop: 105,
      outcome: "target",
      next_day_open: 91,
      session_high: 100.5,
      session_low: 88,
      next_day_close: 90,
    })
  )!;
  assert.equal(short.failure_mode.tag, "gap_win");
});

// ── Taxonomy: stops ──────────────────────────────────────────────────────────────────

test("gap_through_stop: AMD 2026-07-07 (real history) — the loss was decided pre-open", () => {
  const d = debriefPlay(AMD_0707)!;
  assert.equal(d.failure_mode.tag, "gap_through_stop");
  assert.match(d.failure_mode.detail, /515\.91/);
  assert.match(d.failure_mode.detail, /550\.88/);
  assert.match(d.failure_mode.detail, /pre-open pull|morning re-compose/);
  // It DID fill (open below the band is fillable for a LONG).
  assert.equal(d.fill.filled, true);
  assert.equal(d.fill.first_touch, "open");
});

test("gap_through_stop SHORT: open above the stop", () => {
  const d = debriefPlay(
    row({
      direction: "SHORT",
      target: 92,
      stop: 105,
      outcome: "stop",
      next_day_open: 106,
      session_high: 108,
      session_low: 101,
      next_day_close: 107,
    })
  )!;
  assert.equal(d.failure_mode.tag, "gap_through_stop");
});

test("wrong_direction: stopped with almost no progress toward target and an adverse close", () => {
  const d = debriefPlay(
    row({ outcome: "stop", next_day_open: 101, session_high: 102.5, session_low: 94.9, next_day_close: 96 })
  )!;
  // MFE = (102.5-102)/102 = 0.49% of a 7.84% target distance → ratio ~0.06 < 0.25
  assert.equal(d.failure_mode.tag, "wrong_direction");
});

test("wrong_direction SHORT: mirrored", () => {
  const d = debriefPlay(
    row({
      direction: "SHORT",
      target: 92,
      stop: 105,
      outcome: "stop",
      next_day_open: 100.5,
      session_high: 105.5,
      session_low: 99.8, // MFE (100-99.8)/100 = 0.2% of an 8% target distance
      next_day_close: 105,
    })
  )!;
  assert.equal(d.failure_mode.tag, "wrong_direction");
});

test("stopped_normal: real progress toward target before the stop — an in-plan loss", () => {
  const long = debriefPlay(
    row({ outcome: "stop", next_day_open: 101, session_high: 108, session_low: 94.9, next_day_close: 96 })
  )!;
  assert.equal(long.failure_mode.tag, "stopped_normal");
  const short = debriefPlay(
    row({
      direction: "SHORT",
      target: 92,
      stop: 105,
      outcome: "stop",
      next_day_open: 100.5,
      session_high: 105.5,
      session_low: 94, // 75% of the way to target
      next_day_close: 104,
    })
  )!;
  assert.equal(short.failure_mode.tag, "stopped_normal");
});

test("ambiguous grades debrief as stopped_normal with the both-touched explanation", () => {
  const d = debriefPlay(
    row({ outcome: "ambiguous", next_day_open: 101, session_high: 111, session_low: 94, next_day_close: 100 })
  )!;
  assert.equal(d.failure_mode.tag, "stopped_normal");
  assert.match(d.failure_mode.detail, /both target and stop/);
});

// ── Taxonomy: unfilled ───────────────────────────────────────────────────────────────

test("band_detached: DELL 2026-07-08 (real history) — the session never came near the band", () => {
  const d = debriefPlay(DELL_0708)!;
  assert.equal(d.failure_mode.tag, "band_detached");
  assert.equal(d.fill.filled, false);
  // The unfilled explanation carries the day's actual low vs the band edge.
  assert.match(d.fill.detail, /414/);
  assert.match(d.fill.detail, /227\.27/);
  assert.match(d.fill.detail, /ABOVE/);
  assert.equal(d.excursion, null); // no fill → no excursion (no entry ever existed)
});

test("band_detached prefers the PINNED publish-time distance when present", () => {
  const d = debriefPlay({
    ...DELL_0708,
    publish_context: { context_version: 2, band_distance_pct: -45.4988 },
  })!;
  assert.equal(d.failure_mode.tag, "band_detached");
  assert.match(d.failure_mode.detail, /-45\.5% from spot at publish/);
});

test("band_detached SHORT: band far above the market", () => {
  const d = debriefPlay(
    row({
      direction: "SHORT",
      entry_range_low: 150,
      entry_range_high: 152,
      target: 140,
      stop: 156,
      outcome: "unfilled",
      next_day_open: 120,
      session_high: 125, // (150-125)/150 = 16.7% below the band edge
      session_low: 118,
      next_day_close: 121,
    })
  )!;
  assert.equal(d.failure_mode.tag, "band_detached");
});

test("unfilled_never_traded_back: a near miss is NOT a detached band (AMD 2026-07-08 class)", () => {
  const d = debriefPlay(
    row({
      ticker: "AMD",
      edition_for: "2026-07-08",
      entry_range_low: 495,
      entry_range_high: 495.35,
      target: 550.88,
      stop: 486.8,
      outcome: "unfilled",
      next_day_open: 504.805,
      session_high: 522.98,
      session_low: 498.15, // 0.57% above the band top — inside the 2.5% gate distance
      next_day_close: 517.405,
    })
  )!;
  assert.equal(d.failure_mode.tag, "unfilled_never_traded_back");
  assert.match(d.failure_mode.detail, /near-miss/);
});

test("unfilled_never_traded_back SHORT: mirrored near miss", () => {
  const d = debriefPlay(
    row({
      direction: "SHORT",
      entry_range_low: 100,
      entry_range_high: 102,
      target: 92,
      stop: 105,
      outcome: "unfilled",
      next_day_open: 98,
      session_high: 99.5, // 0.5% below the SHORT fill edge (band low 100)
      session_low: 95,
      next_day_close: 96,
    })
  )!;
  assert.equal(d.failure_mode.tag, "unfilled_never_traded_back");
  assert.ok(0.5 < GATE_BAND_MAX_DISTANCE_PCT);
});

// ── Taxonomy: open outcomes ──────────────────────────────────────────────────────────

test("target_unreachable: moved WITH the play and the target still never traded", () => {
  const d = debriefPlay(
    row({
      outcome: "open",
      target: 130,
      next_day_open: 101,
      session_high: 106,
      session_low: 100,
      next_day_close: 105,
      publish_context: { context_version: 2, atr14: 4 },
    })
  )!;
  assert.equal(d.failure_mode.tag, "target_unreachable");
  // |130-102|/4 = 7× ATR — cited against the live gate bar.
  assert.match(d.failure_mode.detail, /7× ATR14/);
});

test("target_unreachable SHORT: mirrored", () => {
  const d = debriefPlay(
    row({
      direction: "SHORT",
      target: 70,
      stop: 105,
      outcome: "open",
      next_day_open: 99,
      session_high: 100.5,
      session_low: 96,
      next_day_close: 97,
    })
  )!;
  assert.equal(d.failure_mode.tag, "target_unreachable");
});

test("wrong_direction on an open outcome: closed against the entry without touching either level", () => {
  const long = debriefPlay(
    row({ outcome: "open", next_day_open: 101, session_high: 103, session_low: 97, next_day_close: 98 })
  )!;
  assert.equal(long.failure_mode.tag, "wrong_direction");
  const short = debriefPlay(
    row({
      direction: "SHORT",
      target: 92,
      stop: 108,
      outcome: "open",
      next_day_open: 100.5,
      session_high: 104,
      session_low: 99,
      next_day_close: 103.5,
    })
  )!;
  assert.equal(short.failure_mode.tag, "wrong_direction");
});

// ── Taxonomy: pulled counterfactuals ─────────────────────────────────────────────────

test("pulled_correctly: the counterfactual grade is a stop — the pull avoided a loser", () => {
  const d = debriefPlay(
    row({
      pulled: true,
      pulled_reason: "Pulled pre-open: gapped through the stop",
      outcome: "stop",
      next_day_open: 94,
      session_high: 96,
      session_low: 92,
      next_day_close: 93,
    })
  )!;
  assert.equal(d.failure_mode.tag, "pulled_correctly");
  assert.match(d.failure_mode.detail, /gapped through the stop/);
  assert.equal(d.pulled, true);
});

test("pulled_wrongly: the counterfactual grade is a target — the pull cost a winner", () => {
  const d = debriefPlay(
    row({ pulled: true, pulled_reason: "Pulled pre-open: regime mismatch", outcome: "target", next_day_open: 101, session_high: 111, session_low: 100, next_day_close: 110 })
  )!;
  assert.equal(d.failure_mode.tag, "pulled_wrongly");
});

test("pulled counterfactual edges: profitable open counts as a win; unfilled/ambiguous never indict the pull", () => {
  assert.equal(pulledPlayWouldHaveWon(row({ outcome: "open", next_day_close: 106 })), true);
  assert.equal(pulledPlayWouldHaveWon(row({ outcome: "open", next_day_close: 99 })), false);
  assert.equal(pulledPlayWouldHaveWon(row({ outcome: "unfilled" })), false);
  assert.equal(pulledPlayWouldHaveWon(row({ outcome: "ambiguous" })), false);
  const d = debriefPlay(row({ pulled: true, outcome: "unfilled", session_low: 105, next_day_open: 106, next_day_close: 107, session_high: 108 }))!;
  assert.equal(d.failure_mode.tag, "pulled_correctly");
  // Pull precedence beats the unfilled taxonomy — the debrief judges the PULL.
  assert.notEqual(d.failure_mode.tag, "band_detached");
});

// ── Fill quality / first-touch buckets ───────────────────────────────────────────────

test("first_touch open: opened inside/through the band", () => {
  const f = computeFill(row({ next_day_open: 101.5 }));
  assert.equal(f.filled, true);
  assert.equal(f.first_touch, "open");
});

test("first_touch from timestamped intraday bars: first_hour vs later", () => {
  const t0 = Date.parse("2026-07-15T13:30:00Z");
  const min = 60_000;
  const mk = (offsetMin: number, l: number) => ({ t: t0 + offsetMin * min, h: l + 2, l, c: l + 1 });
  const base = row({ next_day_open: 104, session_low: 101, session_high: 108, next_day_close: 107 });
  // Touch (l <= 102) at +30min → first_hour.
  const early = computeFill(base, [mk(0, 104), mk(15, 103.2), mk(30, 101.8), mk(45, 103)]);
  assert.equal(early.first_touch, "first_hour");
  // Touch at +120min → later.
  const late = computeFill(base, [mk(0, 104), mk(30, 103), mk(120, 101.8), mk(150, 103)]);
  assert.equal(late.first_touch, "later");
});

test("daily-bar-only non-open fill is honestly intraday_time_unknown", () => {
  const f = computeFill(row({ next_day_open: 104, session_low: 101 }));
  assert.equal(f.filled, true);
  assert.equal(f.first_touch, "intraday_time_unknown");
  assert.match(f.detail, /not resolvable from a daily bar/);
});

test("no band parsed → fillability untestable; no persisted H/L → unknowable unless the open decides", () => {
  const noBand = computeFill(row({ entry_range_low: null, entry_range_high: null }));
  assert.equal(noBand.filled, null);
  const noHL = computeFill(row({ session_high: null, session_low: null, next_day_open: 104 }));
  assert.equal(noHL.filled, null);
  const openProves = computeFill(row({ session_high: null, session_low: null, next_day_open: 101 }));
  assert.equal(openProves.filled, true);
  assert.equal(openProves.first_touch, "open");
});

// ── Excursion math ───────────────────────────────────────────────────────────────────

test("MFE/MAE math is exact from the actual fill price, both directions", () => {
  // Open 101 is inside the band → the fill IS the open, not the band edge.
  const long = computeExcursion(
    row({ session_high: 108, session_low: 99 }),
    computeFill(row({ session_high: 108, session_low: 99 }))
  )!;
  assert.equal(long.entry, 101);
  assert.equal(long.mfe_pct, 6.93); // (108-101)/101
  assert.equal(long.mae_pct, -1.98); // (99-101)/101
  assert.equal(long.target_distance_pct, 8.91);
  assert.equal(long.stop_distance_pct, -5.94);
  assert.equal(long.mfe_vs_target_ratio, 0.78);
  assert.equal(long.mae_vs_stop_ratio, 0.33);
  // A first-touch fill AT the edge keeps the edge as the entry.
  const touchRow = row({ next_day_open: 104, session_high: 108, session_low: 101 });
  const touch = computeExcursion(touchRow, computeFill(touchRow))!;
  assert.equal(touch.entry, 102);
  // A gap-through fill (AMD 7/07 class) is measured from the OPEN, not the edge.
  const gapRow = row({ next_day_open: 97, session_high: 99, session_low: 96 });
  const gap = computeExcursion(gapRow, computeFill(gapRow))!;
  assert.equal(gap.entry, 97);

  const sRow = row({
    direction: "SHORT",
    target: 92,
    stop: 105,
    next_day_open: 100,
    session_high: 103,
    session_low: 94,
  });
  const short = computeExcursion(sRow, computeFill(sRow))!;
  assert.equal(short.entry, 100); // SHORT fill edge = band low
  assert.equal(short.mfe_pct, 6); // (100-94)/100
  assert.equal(short.mae_pct, -3); // (100-103)/100
  assert.equal(short.mfe_vs_target_ratio, 0.75);
  assert.equal(short.mae_vs_stop_ratio, 0.6);
});

test("excursion is null when no fill existed", () => {
  assert.equal(computeExcursion(DELL_0708, computeFill(DELL_0708)), null);
});

// ── Thesis scorecard ─────────────────────────────────────────────────────────────────

test("thesis: direction confirmed/refuted from the pinned reference; regime tested against the actual move", () => {
  const up = debriefPlay(row({ outcome: "open", next_day_close: 105, publish_context: PIN }))!;
  const dir = up.thesis.find((f) => f.label === "direction")!;
  assert.equal(dir.verdict, "confirmed");
  const regime = up.thesis.find((f) => f.label === "regime")!;
  assert.equal(regime.verdict, "confirmed"); // bullish pin + up session

  const down = debriefPlay(row({ outcome: "open", next_day_close: 97, session_low: 96.5, publish_context: PIN }))!;
  assert.equal(down.thesis.find((f) => f.label === "direction")!.verdict, "refuted");
  assert.equal(down.thesis.find((f) => f.label === "regime")!.verdict, "refuted");
});

test("thesis: non-directional regime and missing pin are untestable — never scored", () => {
  const neutral = debriefPlay(
    row({
      outcome: "open",
      publish_context: { ...PIN, market: { composite_regime: "MIXED", tide_bias: "neutral" } },
    })
  )!;
  assert.equal(neutral.thesis.find((f) => f.label === "regime")!.verdict, "untestable");

  const noPin = debriefPlay(row({ outcome: "open", publish_context: null }))!;
  assert.equal(noPin.thesis.find((f) => f.label === "direction")!.verdict, "untestable");
  assert.match(noPin.thesis.find((f) => f.label === "direction")!.detail, /pre-pinning/);
  assert.equal(noPin.thesis.find((f) => f.label === "regime")!.verdict, "untestable");
  // No catalyst factor at all when nothing was flagged (fixed factor set otherwise).
  assert.equal(noPin.thesis.some((f) => f.label === "catalyst"), false);
});

test("thesis: entry_band confirmed on fill, refuted on unfilled", () => {
  const filled = debriefPlay(row({ outcome: "open" }))!;
  assert.equal(filled.thesis.find((f) => f.label === "entry_band")!.verdict, "confirmed");
  const unfilled = debriefPlay(DELL_0708)!;
  assert.equal(unfilled.thesis.find((f) => f.label === "entry_band")!.verdict, "refuted");
});

test("thesis: a flagged catalyst is refuted by an adverse gap through the stop, confirmed by an orderly open", () => {
  const flaggedPin = {
    ...PIN,
    spot_at_publish: 552.05,
    prior_close: 552.05,
    catalysts: { earnings_tomorrow: true, earnings_date: "2026-07-07", earnings_risk: true, catalyst_flags: [] },
  };
  const gapped = debriefPlay({ ...AMD_0707, publish_context: flaggedPin })!;
  const cat = gapped.thesis.find((f) => f.label === "catalyst")!;
  assert.equal(cat.verdict, "refuted");
  assert.match(cat.detail, /through the published stop/);

  const orderly = debriefPlay(
    row({ outcome: "open", publish_context: { ...PIN, catalysts: { ...PIN.catalysts, earnings_risk: true } } })
  )!;
  assert.equal(orderly.thesis.find((f) => f.label === "catalyst")!.verdict, "confirmed");
});

// ── Shape / envelope invariants ──────────────────────────────────────────────────────

test("pending rows have no debrief; graded rows carry the version + grade echo", () => {
  assert.equal(debriefPlay(row({ outcome: "pending" })), null);
  const d = debriefPlay(AMD_0707)!;
  assert.equal(d.debrief_version, DEBRIEF_VERSION);
  assert.equal(d.outcome, "stop");
  assert.equal(d.grade_methodology, GRADE_METHODOLOGY_CURRENT);
  assert.equal(d.direction, "LONG");
  assert.equal(d.ticker, "AMD");
});

test("readDebriefPin: version-gated structural read (malformed → null, never a guess)", () => {
  assert.equal(readDebriefPin(null), null);
  assert.equal(readDebriefPin("x"), null);
  assert.equal(readDebriefPin({}), null); // no context_version
  const pin = readDebriefPin(PIN)!;
  assert.equal(pin.atr14, 3.5);
  assert.equal(pin.composite_regime, "BULLISH risk-on");
  assert.equal(pin.tier, null); // no tier pinned yet — read as absent, not invented
});

test("helpers: fill edge follows the transactable-side convention; session bar mirrors the persisted grading bar", () => {
  assert.equal(fillEdgeOf(row()), 102);
  assert.equal(fillEdgeOf(row({ direction: "SHORT" })), 100);
  assert.deepEqual(sessionBarFromRow(AMD_0707), { o: 515.91, h: 524.97, l: 503.11, c: 516.11 });
});
