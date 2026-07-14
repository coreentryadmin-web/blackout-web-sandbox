// PR-N10 — the SESSION-level debrief roll-up tests. Hermetic + pure: fixture rows in,
// deterministic session debrief out. Every bucket (went-well / real-winners / misfired /
// how-to-improve) and every honesty gate (#333 anti-blend, low-N, no fabricated win-rate) is
// exercised. The failure-mode fixtures are constructed to trip debriefPlay's real classifier
// (clean_win / lucky_win / wrong_direction / stopped_normal / gap_through_stop / band_detached /
// unfilled_never_traded_back / pulled_wrongly / pulled_correctly) so the roll-up is tested
// against the SAME physics the pinned per-play debrief uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionDebrief,
  buildSessionObservations,
  cortexSupportSources,
  morningNote,
  SESSION_DEBRIEF_VERSION,
  type SessionDebriefRow,
} from "./session-debrief";
import { debriefPlay } from "./debrief";
import { GRADE_METHODOLOGY_CURRENT } from "./grade-methodology";

// ── Fixtures ─────────────────────────────────────────────────────────────────────────

function row(over: Partial<SessionDebriefRow> = {}): SessionDebriefRow {
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
    session_low: 100.5,
    outcome: "target",
    pulled: false,
    pulled_reason: null,
    publish_context: null,
    morning_verdict: null,
    grade_methodology: GRADE_METHODOLOGY_CURRENT,
    ...over,
  };
}

const CORTEX_PIN = {
  context_version: 2,
  cortex_overnight: {
    direction: "long",
    supports: [{ source: "flow-persistence", weight: 2 }, { source: "darkpool-trend", weight: 1 }],
    opposes: [],
    absent: [],
  },
};

// A clean win: fills at the open, reaches target, tiny drawdown (well under the lucky bar).
const CLEAN_WIN = row({
  ticker: "AAA",
  outcome: "target",
  next_day_open: 101,
  session_high: 111,
  session_low: 100.5,
  next_day_close: 110,
  publish_context: CORTEX_PIN,
});

// A lucky win: graded target but the low nearly reached the stop (>=75% of stop budget).
const LUCKY_WIN = row({
  ticker: "BBB",
  outcome: "target",
  next_day_open: 101,
  session_high: 111,
  session_low: 95.5,
  next_day_close: 110,
});

// Wrong direction: filled, barely moved up, stopped and closed against the entry.
const WRONG_DIR = row({
  ticker: "CCC",
  outcome: "stop",
  next_day_open: 101,
  session_high: 101.5,
  session_low: 94,
  next_day_close: 94,
});

// Stopped normal: reached ~40% of the target distance before stopping (not a wrong-direction).
const STOPPED_NORMAL = row({
  ticker: "DDD",
  outcome: "stop",
  next_day_open: 101,
  session_high: 105,
  session_low: 94,
  next_day_close: 96,
});

// Gap through stop: opened already beyond the published stop.
const GAP_THROUGH_STOP = row({
  ticker: "EEE",
  outcome: "stop",
  next_day_open: 94,
  session_high: 96,
  session_low: 92,
  next_day_close: 93,
});

// Band detached: never traded within the gate distance of the band (unfilled).
const BAND_DETACHED = row({
  ticker: "FFF",
  outcome: "unfilled",
  next_day_open: 112,
  session_high: 115,
  session_low: 110,
  next_day_close: 113,
});

// Unfilled near-miss: the band was missed by under the gate distance.
const NEAR_MISS = row({
  ticker: "GGG",
  outcome: "unfilled",
  next_day_open: 103.5,
  session_high: 104,
  session_low: 103,
  next_day_close: 103.2,
});

// Pulled wrongly: pulled pre-open but the counterfactual is a target (would have won).
const PULLED_WRONGLY = row({
  ticker: "HHH",
  outcome: "target",
  pulled: true,
  pulled_reason: "Pulled pre-open: overnight axis flipped",
  session_low: 100.5,
});

// Pulled correctly: pulled and the counterfactual is a loss (a good pull).
const PULLED_CORRECTLY = row({
  ticker: "III",
  outcome: "stop",
  pulled: true,
  pulled_reason: "Pulled pre-open: gapped through stop",
  next_day_open: 94,
  session_low: 92,
  next_day_close: 93,
});

// ── Sanity: the fixtures actually trip the intended failure modes ─────────────────────

test("fixtures trip the intended debriefPlay failure modes", () => {
  assert.equal(debriefPlay(CLEAN_WIN)?.failure_mode.tag, "clean_win");
  assert.equal(debriefPlay(LUCKY_WIN)?.failure_mode.tag, "lucky_win");
  assert.equal(debriefPlay(WRONG_DIR)?.failure_mode.tag, "wrong_direction");
  assert.equal(debriefPlay(STOPPED_NORMAL)?.failure_mode.tag, "stopped_normal");
  assert.equal(debriefPlay(GAP_THROUGH_STOP)?.failure_mode.tag, "gap_through_stop");
  assert.equal(debriefPlay(BAND_DETACHED)?.failure_mode.tag, "band_detached");
  assert.equal(debriefPlay(NEAR_MISS)?.failure_mode.tag, "unfilled_never_traded_back");
  assert.equal(debriefPlay(PULLED_WRONGLY)?.failure_mode.tag, "pulled_wrongly");
  assert.equal(debriefPlay(PULLED_CORRECTLY)?.failure_mode.tag, "pulled_correctly");
});

// ── Structural readers ────────────────────────────────────────────────────────────────

test("cortexSupportSources reads pinned support ids; degrades to [] on junk", () => {
  assert.deepEqual(cortexSupportSources(CORTEX_PIN), ["flow-persistence", "darkpool-trend"]);
  assert.deepEqual(cortexSupportSources(null), []);
  assert.deepEqual(cortexSupportSources({}), []);
  assert.deepEqual(cortexSupportSources({ cortex_overnight: { supports: "nope" } }), []);
});

test("morningNote prefers verdict reason, falls back to pull reason", () => {
  assert.equal(
    morningNote(row({ morning_verdict: { status: "INVALIDATED", reason: "gapped through stop" } })),
    "INVALIDATED: gapped through stop"
  );
  assert.equal(morningNote(row({ pulled_reason: "Pulled pre-open: x" })), "Pulled pre-open: x");
  assert.equal(morningNote(row()), null);
});

// ── The buckets ───────────────────────────────────────────────────────────────────────

test("winners land in went_well + real_winners with the carrying evidence", () => {
  const d = buildSessionDebrief({ editionFor: "2026-07-14", rows: [CLEAN_WIN, LUCKY_WIN] });
  const tickers = d.what_went_well.map((w) => w.ticker).sort();
  assert.deepEqual(tickers, ["AAA", "BBB"]);
  const clean = d.what_went_well.find((w) => w.ticker === "AAA")!;
  assert.deepEqual(clean.carried_by, ["flow-persistence", "darkpool-trend"]);
  assert.equal(clean.failure_mode, "clean_win");

  // real_winners is the numeric ledger (both are enterable target wins).
  const rw = d.real_winners.map((w) => w.ticker).sort();
  assert.deepEqual(rw, ["AAA", "BBB"]);
  for (const w of d.real_winners) assert.equal(typeof w.realized_return_pct, "number");
});

test("misfires are bucketed with the right honest class", () => {
  const d = buildSessionDebrief({
    editionFor: "2026-07-14",
    rows: [WRONG_DIR, STOPPED_NORMAL, GAP_THROUGH_STOP, BAND_DETACHED, NEAR_MISS, PULLED_WRONGLY],
  });
  const byTicker = new Map(d.what_misfired.map((m) => [m.ticker, m]));
  assert.equal(byTicker.get("CCC")!.misfire_class, "thesis_wrong");
  assert.equal(byTicker.get("DDD")!.misfire_class, "thesis_right_execution");
  assert.equal(byTicker.get("EEE")!.misfire_class, "gapped_pre_open");
  assert.equal(byTicker.get("FFF")!.misfire_class, "structural_band");
  assert.equal(byTicker.get("GGG")!.misfire_class, "no_fill");
  assert.equal(byTicker.get("HHH")!.misfire_class, "pull_removed_winner");
  // Each misfire carries the deterministic WHY.
  for (const m of d.what_misfired) assert.ok(m.why.length > 0);
});

test("pulled_correctly is NOT a misfire (system working); surfaced honestly", () => {
  const d = buildSessionDebrief({ editionFor: "2026-07-14", rows: [PULLED_CORRECTLY] });
  assert.equal(d.what_misfired.length, 0);
  assert.equal(d.what_went_well.length, 0);
  assert.equal(d.summary.pulled, 1);
});

test("gap_win is a win but never an enterable real_winner", () => {
  // Open already beyond target ⇒ debriefPlay tags gap_win.
  const GAP_WIN = row({ ticker: "ZZZ", outcome: "target", next_day_open: 111, session_high: 112, session_low: 110 });
  assert.equal(debriefPlay(GAP_WIN)?.failure_mode.tag, "gap_win");
  const d = buildSessionDebrief({ editionFor: "2026-07-14", rows: [GAP_WIN] });
  assert.equal(d.what_went_well.length, 1); // counted as a win
  assert.equal(d.real_winners.length, 0); // but not enterable
});

// ── Honesty gates ─────────────────────────────────────────────────────────────────────

test("summary uses the scoreable denominator and flags low-N; win_rate null when nothing scoreable", () => {
  const d = buildSessionDebrief({ editionFor: "2026-07-14", rows: [CLEAN_WIN, WRONG_DIR, BAND_DETACHED, PULLED_WRONGLY] });
  // scoreable = graded, not unfilled, not pulled ⇒ CLEAN_WIN + WRONG_DIR = 2.
  assert.equal(d.summary.scoreable, 2);
  assert.equal(d.summary.winners, 1);
  assert.equal(d.summary.losers, 1);
  assert.equal(d.summary.unfilled, 1);
  assert.equal(d.summary.pulled, 1);
  assert.equal(d.summary.win_rate_pct, 50);
  assert.equal(d.summary.low_n, true); // < LOW_N_THRESHOLD

  const empty = buildSessionDebrief({ editionFor: "2026-07-14", rows: [BAND_DETACHED] });
  assert.equal(empty.summary.win_rate_pct, null); // nothing scoreable ⇒ no fabricated rate
});

test("#333 anti-blend: legacy-methodology rows are counted, never bucketed", () => {
  const legacy = row({ ticker: "OLD", outcome: "target", grade_methodology: "v1_legacy", session_high: 111, session_low: 100.5 });
  const d = buildSessionDebrief({ editionFor: "2026-07-14", rows: [CLEAN_WIN, legacy] });
  assert.equal(d.plays_graded, 1); // only the current-methodology row
  assert.equal(d.legacy_excluded, 1);
  assert.equal(d.what_went_well.length, 1);
  assert.equal(d.what_went_well[0]!.ticker, "AAA");
});

test("pending rows are excluded; available reflects graded plays", () => {
  const pending = row({ ticker: "PEND", outcome: "pending" });
  const none = buildSessionDebrief({ editionFor: "2026-07-14", rows: [pending] });
  assert.equal(none.available, false);
  assert.equal(none.plays_graded, 0);

  const some = buildSessionDebrief({ editionFor: "2026-07-14", rows: [pending, CLEAN_WIN] });
  assert.equal(some.available, true);
  assert.equal(some.plays_graded, 1);
});

test("version + editionFor + window_patterns passthrough", () => {
  const patterns = [{ signal: "x", evidence: { n: 9, delta: 20 }, suggestion: "do y", low_n: false }];
  const d = buildSessionDebrief({ editionFor: "2026-07-10", rows: [CLEAN_WIN], windowPatterns: patterns });
  assert.equal(d.session_debrief_version, SESSION_DEBRIEF_VERSION);
  assert.equal(d.edition_for, "2026-07-10");
  assert.deepEqual(d.how_to_improve.window_patterns, patterns);
});

// ── Session observations (deterministic, always low-N, never actionable) ──────────────

test("session observations: pull_removed_winner + lucky wins, all low-N, suggestion null", () => {
  const d = buildSessionDebrief({ editionFor: "2026-07-14", rows: [PULLED_WRONGLY, LUCKY_WIN, WRONG_DIR] });
  const obs = d.how_to_improve.session_observations;
  assert.ok(obs.some((o) => o.signal === "session:pull_removed_winner"));
  assert.ok(obs.some((o) => o.signal === "session:lucky_wins"));
  // Every session observation is low-N and carries no actionable suggestion.
  for (const o of obs) {
    assert.equal(o.low_n, true);
    assert.equal(o.suggestion, null);
    assert.ok(o.evidence.n >= 1);
  }
});

test("buildSessionObservations returns [] when there is nothing to observe", () => {
  assert.deepEqual(buildSessionObservations([CLEAN_WIN], []), []);
});
