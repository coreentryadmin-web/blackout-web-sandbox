// PR-N10 — the Debrief: automated end-of-session post-mortem for Night Hawk overnight
// plays ("what went well, what plays were real winners, what went wrong, what misfired,
// how can we improve the system" — every session, deterministic, no LLM anywhere).
//
// WHY THIS EXISTS: grading (play-outcomes.ts resolveOutcome) answers only "target/stop/
// open/unfilled". It cannot say WHY: the record's only A+ play (AMD 2026-07-07) graded
// "stop" identically to an ordinary noise stop-out, even though it gapped −6.55% through
// its published stop pre-open (a gap loss no intraday discipline could have prevented);
// DELL 2026-07-08 graded "unfilled" identically to a play whose band was missed by 30
// cents, even though its band sat 45% below the market (the N-3 detached-band class).
// Aggregating grades without failure MODES made "how do we improve" unanswerable —
// docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §2.2 had to reconstruct all of this by hand,
// once. This module makes that forensic pass a per-play product artifact.
//
// HONESTY RULES (same spine as publish-context.ts / morning-verdict-persist.ts):
//  - Inputs are ONLY the graded outcome row (with its pinned publish_context /
//    morning_verdict / pulled state) + the session bars — the SAME persisted daily bar
//    grading used. Nothing is re-fetched, nothing reconstructed after the fact.
//  - A single daily bar cannot order intrabar events. Where sequence matters (did the
//    drawdown come before the target touch?) the verdict says what IS knowable
//    ("the session drew down X% of the stop distance at some point") and the tag
//    definitions are explicit about the conservatism applied.
//  - Missing evidence degrades to `untestable`/null with the reason in `detail` —
//    never a guessed verdict. Pre-#331 rows (no publish pin) get a thesis scorecard of
//    untestable factors, not a reconstructed one.
//
// Pure module: no I/O, no clocks, no db imports at runtime (the row type import is
// type-only). Persistence/cron live in debrief-persist.ts; aggregation in
// debrief-aggregate.ts.

import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import { entryRangeMid } from "./entry-range";
// Single source of truth for the publish-gate thresholds (PR-N3) — the debrief
// classifies history with the SAME numbers the live gates block on, so "this would
// have been gated" and "this was gated" can never drift apart.
import { GATE_BAND_MAX_DISTANCE_PCT, GATE_TARGET_MAX_ATR_MULTIPLE } from "./publish-gates";

/** Bump when the pinned debrief shape changes so aggregate reads can segment. */
export const DEBRIEF_VERSION = 1;

// ── Classification thresholds (named constants — calibratable, like the publish gates) ──

/** A graded WIN whose worst drawdown consumed at least this fraction of the published
 *  stop distance is a `lucky_win`, not a `clean_win`: the session traded through most
 *  of the room the plan had before it would have been a loss. With one daily bar the
 *  ORDER of low-vs-target-touch is unknowable — the conservative reading (documented in
 *  the tag detail) is that the drawdown was real that session either way, so a win that
 *  needed 75%+ of its stop budget to survive is never advertised as clean. */
export const LUCKY_WIN_MAE_STOP_FRACTION = 0.75;

/** A stop-out that never traveled even this fraction of the way to its target before
 *  the session ended against it is a `wrong_direction` call (the thesis itself failed),
 *  not a `stopped_normal` (right idea, stopped on an adverse swing). */
export const WRONG_DIRECTION_MFE_TARGET_FRACTION = 0.25;

/** First-touch bucketing: a fill inside this many minutes of the session's first bar is
 *  "first_hour" (only computable when intraday bars are provided — see DebriefBar). */
export const FIRST_HOUR_MINUTES = 60;

/** Catalyst scorecard: an adverse overnight gap at/above this % (against the play
 *  direction) on a catalyst-flagged play refutes "the play survives its catalyst". */
export const CATALYST_ADVERSE_GAP_PCT = 3;

// ── Input shapes ────────────────────────────────────────────────────────────────────

/** One session bar. The debrief's LEVEL math always uses the row's own persisted daily
 *  bar (the exact inputs grading used); an optional array of TIMESTAMPED intraday bars
 *  refines ONLY the first-touch time bucket — it never changes a level verdict. */
export type DebriefBar = {
  /** Epoch ms — required for intraday bars to be usable for time bucketing. */
  t?: number | null;
  o?: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
};

/** The outcome-row slice the debrief reads (structural subset of db.ts's
 *  NighthawkPlayOutcomeRow so tests build small fixtures). */
export type DebriefRowLike = Pick<
  NighthawkPlayOutcomeRow,
  | "edition_for"
  | "ticker"
  | "direction"
  | "conviction"
  | "entry_range_low"
  | "entry_range_high"
  | "target"
  | "stop"
  | "next_day_open"
  | "next_day_close"
  | "session_high"
  | "session_low"
  | "outcome"
  | "pulled"
  | "pulled_reason"
  | "publish_context"
  | "morning_verdict"
  | "grade_methodology"
>;

/** The persisted daily bar as grading saw it — the debrief's canonical bar. */
export function sessionBarFromRow(row: DebriefRowLike): DebriefBar {
  return { o: row.next_day_open, h: row.session_high, l: row.session_low, c: row.next_day_close };
}

// ── Output shapes ───────────────────────────────────────────────────────────────────

/** The fixed failure-mode taxonomy — one PRIMARY tag per graded play. Precedence is
 *  deterministic and documented on classifyFailureMode below. `gap_win` should be
 *  impossible for post-#333 grades (an open-beyond-target session grades `unfilled`
 *  under fillability rules) but the taxonomy must cover legacy history honestly. */
export const DEBRIEF_FAILURE_MODES = [
  "clean_win",
  "lucky_win",
  "gap_win",
  "stopped_normal",
  "wrong_direction",
  "gap_through_stop",
  "target_unreachable",
  "band_detached",
  "unfilled_never_traded_back",
  "pulled_correctly",
  "pulled_wrongly",
] as const;
export type DebriefFailureMode = (typeof DEBRIEF_FAILURE_MODES)[number];

export type DebriefFirstTouch = "open" | "first_hour" | "later" | "intraday_time_unknown";

export type DebriefFill = {
  /** null = unknowable (no intraday high/low persisted and the open doesn't decide). */
  filled: boolean | null;
  /** The band edge the member would transact at (LONG: band top; SHORT: band low) —
   *  same convention as publish-context.ts's fill_edge. */
  fill_edge: number | null;
  first_touch: DebriefFirstTouch | null;
  detail: string;
};

export type DebriefExcursion = {
  /** Entry basis for all excursion math = the ACTUAL conservative fill price: the
   *  session OPEN when the open was already at/through the band edge (a gap-through
   *  fill transacts at the open, not at the published edge — AMD 2026-07-07 filled at
   *  515.91, not 555), else the band edge (a first touch fills at the edge). */
  entry: number | null;
  /** Max favorable excursion, signed % of entry (>= 0 when the session ever moved the
   *  play's way). LONG: high vs entry; SHORT: low vs entry. */
  mfe_pct: number | null;
  /** Max adverse excursion, signed % of entry (<= 0 when the session ever moved against). */
  mae_pct: number | null;
  /** Plan distances from the same entry, for ratio context. */
  target_distance_pct: number | null;
  stop_distance_pct: number | null;
  /** mfe/target-distance — 1.0+ means the target was reached. */
  mfe_vs_target_ratio: number | null;
  /** mae/stop-distance (both adverse-signed, so the ratio is >= 0) — 1.0+ means the
   *  full stop distance traded. */
  mae_vs_stop_ratio: number | null;
  detail: string;
};

export type DebriefThesisVerdict = "confirmed" | "refuted" | "untestable";
export type DebriefThesisFactor = { label: string; verdict: DebriefThesisVerdict; detail: string };

export type PlayDebrief = {
  debrief_version: typeof DEBRIEF_VERSION;
  ticker: string;
  edition_for: string;
  direction: "LONG" | "SHORT";
  conviction: string | null;
  /** Echo of the grade this debrief explains (and the rule set that produced it). */
  outcome: NighthawkPlayOutcomeRow["outcome"];
  grade_methodology: string | null;
  pulled: boolean;
  fill: DebriefFill;
  /** null when no fill existed (unfilled) or the bar data can't support the math. */
  excursion: DebriefExcursion | null;
  thesis: DebriefThesisFactor[];
  failure_mode: { tag: DebriefFailureMode; detail: string };
};

// ── Small helpers ───────────────────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;

function pctOf(base: number, move: number): number {
  return round2((move / base) * 100);
}

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isLongRow(row: DebriefRowLike): boolean {
  return row.direction !== "SHORT";
}

/** The fillable band edge — LONG: band top, SHORT: band low (publish-context.ts's
 *  convention; the level the member would actually transact at). */
export function fillEdgeOf(row: DebriefRowLike): number | null {
  return (isLongRow(row) ? row.entry_range_high : row.entry_range_low) ?? null;
}

/** Realized close-vs-entry-mid return % (same math as analytics.ts's
 *  realizedReturnPct, re-derived locally so this module stays db-free at runtime;
 *  entryRangeMid applies the shared corrupt-band guard). */
export function debriefRealizedReturnPct(row: DebriefRowLike): number | null {
  const mid = entryRangeMid(row.entry_range_low, row.entry_range_high);
  const close = row.next_day_close;
  if (mid == null || close == null || mid === 0) return null;
  return ((isLongRow(row) ? close - mid : mid - close) / mid) * 100;
}

/** The pulled-play counterfactual: would the play have WON had it stayed on the board?
 *  Strict: a win is a graded `target`, or an `open` that closed profitably. `stop`/
 *  `unfilled` are not-wins; `ambiguous` (both levels traded, open decided neither) and
 *  a missing close are NOT wins either — an unclear counterfactual never indicts the
 *  pull (conservative in the pull's favor, mirroring skip-grading.ts's tie rule of
 *  never inflating "blocked value"). */
export function pulledPlayWouldHaveWon(row: DebriefRowLike): boolean {
  if (row.outcome === "target") return true;
  if (row.outcome === "open") return (debriefRealizedReturnPct(row) ?? 0) > 0;
  return false;
}

// ── Structural publish-pin reader (local + minimal) ─────────────────────────────────
// The debrief only needs a few pinned scalars. Read structurally (never trust a JSON
// column), version-gated like bie/nighthawk-edition-read.ts's reader — a malformed or
// pre-#331 blob degrades to nulls, never a guess.

export type DebriefPinLike = {
  spot_at_publish: number | null;
  prior_close: number | null;
  atr14: number | null;
  band_distance_pct: number | null;
  composite_regime: string | null;
  tide_bias: string | null;
  earnings_tomorrow: boolean;
  earnings_risk: boolean;
  catalyst_flags: string[];
  tier: string | null;
};

export function readDebriefPin(raw: unknown): DebriefPinLike | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (!finite(p.context_version as number | undefined)) return null;
  const num = (v: unknown): number | null => (finite(v as number) ? (v as number) : null);
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const market = (p.market && typeof p.market === "object" ? p.market : {}) as Record<string, unknown>;
  const cats = (p.catalysts && typeof p.catalysts === "object" ? p.catalysts : {}) as Record<string, unknown>;
  return {
    spot_at_publish: num(p.spot_at_publish),
    prior_close: num(p.prior_close),
    atr14: num(p.atr14),
    band_distance_pct: num(p.band_distance_pct),
    composite_regime: str(market.composite_regime),
    tide_bias: str(market.tide_bias),
    earnings_tomorrow: cats.earnings_tomorrow === true,
    earnings_risk: cats.earnings_risk === true,
    catalyst_flags: Array.isArray(cats.catalyst_flags)
      ? cats.catalyst_flags.filter((f): f is string => typeof f === "string")
      : [],
    // No NH tier engine exists yet (decision doc PR-N7) — read the slot structurally so
    // per-tier aggregation lights up the day a tier is pinned, without a schema change.
    tier: str(p.tier),
  };
}

// ── Fill quality ────────────────────────────────────────────────────────────────────

/** Did the session ever trade into reach of the published band, and when?
 *
 *  Level verdicts come from the persisted daily bar ONLY (grading's inputs). The
 *  optional `intradayBars` (timestamped) refine the TIME bucket: without them a
 *  non-open fill is honestly "intraday_time_unknown" — a daily bar cannot say whether
 *  the touch was 9:47 or 15:12, and the debrief never pretends otherwise. */
export function computeFill(row: DebriefRowLike, intradayBars: DebriefBar[] = []): DebriefFill {
  const isLong = isLongRow(row);
  const edge = fillEdgeOf(row);
  const bar = sessionBarFromRow(row);

  if (edge == null) {
    return { filled: null, fill_edge: null, first_touch: null, detail: "no published entry band parsed — fillability is untestable" };
  }

  const open = bar.o ?? null;
  const reach = isLong ? bar.l : bar.h; // the side of the bar that must reach the edge
  const openFilled = open != null ? (isLong ? open <= edge : open >= edge) : null;

  if (reach == null) {
    // No intraday high/low persisted (the stop_data_unavailable class) — the open can
    // still prove a fill, but absence of a touch is unknowable.
    if (openFilled === true) {
      return { filled: true, fill_edge: edge, first_touch: "open", detail: `opened ${fmt(open!)} inside/through the band edge ${fmt(edge)} — fillable at the open` };
    }
    return { filled: null, fill_edge: edge, first_touch: null, detail: "no session high/low persisted — cannot verify whether the band ever traded" };
  }

  const filled = isLong ? reach <= edge : reach >= edge;
  if (!filled) {
    const missPct = pctOf(edge, isLong ? reach - edge : edge - reach);
    return {
      filled: false,
      fill_edge: edge,
      first_touch: null,
      detail: isLong
        ? `never traded back to the band: session low ${fmt(reach)} stayed ${missPct}% ABOVE the band edge ${fmt(edge)}`
        : `never traded back to the band: session high ${fmt(reach)} stayed ${missPct}% BELOW the band edge ${fmt(edge)}`,
    };
  }

  // Filled — bucket the first touch.
  if (openFilled === true) {
    return { filled: true, fill_edge: edge, first_touch: "open", detail: `opened ${fmt(open!)} inside/through the band edge ${fmt(edge)} — filled at the open` };
  }
  const timed = intradayBars.filter((b) => finite(b.t) && (isLong ? finite(b.l) : finite(b.h)));
  if (timed.length > 1) {
    const sorted = [...timed].sort((a, b) => (a.t! as number) - (b.t! as number));
    const sessionStart = sorted[0]!.t!;
    const touch = sorted.find((b) => (isLong ? b.l! <= edge : b.h! >= edge));
    if (touch) {
      const minutes = (touch.t! - sessionStart) / 60_000;
      const bucket: DebriefFirstTouch = minutes <= FIRST_HOUR_MINUTES ? "first_hour" : "later";
      return { filled: true, fill_edge: edge, first_touch: bucket, detail: `first traded into the band ~${Math.round(minutes)} min after the open (${bucket.replace("_", " ")})` };
    }
    // Intraday bars disagree with the daily bar (partial feed) — the daily bar (the
    // grading input) wins on the LEVEL; the time stays unknown.
  }
  return {
    filled: true,
    fill_edge: edge,
    first_touch: "intraday_time_unknown",
    detail: `the session traded into the band (daily ${isLong ? "low" : "high"} ${fmt(reach)} vs edge ${fmt(edge)}) after an open outside it — touch time not resolvable from a daily bar`,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// ── Excursion (MFE/MAE) ─────────────────────────────────────────────────────────────

/** MFE/MAE from the actual conservative fill price — only meaningful once a fill
 *  existed. Entry = the OPEN when the open was already at/through the band edge (a
 *  gap-through fill transacts at the open price, never at the published edge), else
 *  the band edge itself. One daily bar gives magnitudes, not order; ratio consumers
 *  must respect that (the lucky_win tag's doc carries the conservatism). */
export function computeExcursion(row: DebriefRowLike, fill: DebriefFill): DebriefExcursion | null {
  if (fill.filled !== true || fill.fill_edge == null) return null;
  const bar = sessionBarFromRow(row);
  if (!finite(bar.h) || !finite(bar.l)) return null;
  const isLong = isLongRow(row);
  const edge = fill.fill_edge;
  const openFilled = finite(bar.o) && (isLong ? bar.o <= edge : bar.o >= edge);
  const entry = openFilled ? bar.o! : edge;

  const mfe = isLong ? pctOf(entry, bar.h - entry) : pctOf(entry, entry - bar.l);
  const mae = isLong ? pctOf(entry, bar.l - entry) : pctOf(entry, entry - bar.h);
  const targetDist = finite(row.target) ? pctOf(entry, isLong ? row.target - entry : entry - row.target) : null;
  const stopDist = finite(row.stop) ? pctOf(entry, isLong ? row.stop - entry : entry - row.stop) : null;

  // Ratios only when the plan distance is a real, correctly-signed number (a target on
  // the wrong side of the entry — corrupt geometry — must not mint a negative ratio).
  const mfeVsTarget = targetDist != null && targetDist > 0 ? round2(mfe / targetDist) : null;
  const maeVsStop = stopDist != null && stopDist < 0 && mae <= 0 ? round2(mae / stopDist) : null;

  return {
    entry,
    mfe_pct: mfe,
    mae_pct: mae,
    target_distance_pct: targetDist,
    stop_distance_pct: stopDist,
    mfe_vs_target_ratio: mfeVsTarget,
    mae_vs_stop_ratio: maeVsStop,
    detail:
      `from the fill price ${fmt(entry)}: best ${mfe >= 0 ? "+" : ""}${mfe}% / worst ${mae}%` +
      (mfeVsTarget != null ? ` · reached ${round2(mfeVsTarget * 100)}% of the target distance` : "") +
      (maeVsStop != null ? ` · consumed ${round2(maeVsStop * 100)}% of the stop distance` : "") +
      " (single-bar magnitudes — intrabar order unknowable)",
  };
}

// ── Thesis scorecard ────────────────────────────────────────────────────────────────

/** Which pinned publish-time claims did the tape confirm or refute? Every factor is a
 *  claim the publish context actually made; missing evidence is `untestable` with the
 *  reason — never scored. Deterministic factor set:
 *   1. direction — close-to-close move vs the published direction (reference = pinned
 *      spot at publish, falling back to pinned prior close);
 *   2. entry band — the band was where the tape would trade (fill happened);
 *   3. regime alignment — the pinned evening regime/tide supported this direction AND
 *      the session moved that way;
 *   4. catalyst — only when the pin flagged one: the play survived it without an
 *      adverse gap through the stop / >= CATALYST_ADVERSE_GAP_PCT against it. */
export function buildThesisScorecard(row: DebriefRowLike, pin: DebriefPinLike | null, fill: DebriefFill): DebriefThesisFactor[] {
  const isLong = isLongRow(row);
  const factors: DebriefThesisFactor[] = [];
  const reference = pin?.spot_at_publish ?? pin?.prior_close ?? null;
  const close = row.next_day_close;

  // 1) Direction.
  if (reference != null && close != null) {
    const movePct = pctOf(reference, close - reference);
    const withPlay = isLong ? movePct > 0 : movePct < 0;
    factors.push({
      label: "direction",
      verdict: movePct === 0 ? "untestable" : withPlay ? "confirmed" : "refuted",
      detail: `published ${row.direction}; close-to-close move ${movePct >= 0 ? "+" : ""}${movePct}% vs the pinned reference ${fmt(reference)}${movePct === 0 ? " — dead flat, neither confirms nor refutes" : ""}`,
    });
  } else {
    factors.push({
      label: "direction",
      verdict: "untestable",
      detail: reference == null ? "no pinned publish-time price to measure the move from (pre-pinning row)" : "no session close persisted",
    });
  }

  // 2) Entry band.
  factors.push(
    fill.filled === true
      ? { label: "entry_band", verdict: "confirmed", detail: `the tape traded into the published band (${fill.detail})` }
      : fill.filled === false
        ? { label: "entry_band", verdict: "refuted", detail: `the published band never traded (${fill.detail})` }
        : { label: "entry_band", verdict: "untestable", detail: fill.detail }
  );

  // 3) Regime alignment. Only a pinned DIRECTIONAL regime read is testable.
  const regimeText = `${pin?.composite_regime ?? ""} ${pin?.tide_bias ?? ""}`.toUpperCase();
  const regimeBias = regimeText.includes("BULL") ? "LONG" : regimeText.includes("BEAR") ? "SHORT" : null;
  if (pin == null) {
    factors.push({ label: "regime", verdict: "untestable", detail: "no pinned evening regime (pre-pinning row)" });
  } else if (regimeBias == null) {
    factors.push({
      label: "regime",
      verdict: "untestable",
      detail: `pinned regime "${pin.composite_regime ?? "—"}" / tide "${pin.tide_bias ?? "—"}" is not directional — nothing to test`,
    });
  } else if (reference != null && close != null && close !== reference) {
    const sessionBias = close > reference ? "LONG" : "SHORT";
    factors.push({
      label: "regime",
      verdict: sessionBias === regimeBias ? "confirmed" : "refuted",
      detail: `pinned regime read ${regimeBias === "LONG" ? "bullish" : "bearish"} (${pin.composite_regime ?? "—"}/${pin.tide_bias ?? "—"}); the session actually moved ${sessionBias === "LONG" ? "up" : "down"}`,
    });
  } else {
    factors.push({ label: "regime", verdict: "untestable", detail: "no close-to-close move measurable against the pinned regime" });
  }

  // 4) Catalyst — only when the pin flagged one (the factor set stays fixed otherwise).
  const catalystFlagged = pin != null && (pin.earnings_tomorrow || pin.earnings_risk || pin.catalyst_flags.length > 0);
  if (catalystFlagged) {
    const open = row.next_day_open;
    const what = pin!.earnings_tomorrow ? "earnings into the session" : pin!.earnings_risk ? "earnings risk" : `flags: ${pin!.catalyst_flags.join(", ")}`;
    if (reference != null && open != null) {
      const gapPct = pctOf(reference, open - reference);
      const adverse = isLong ? gapPct < 0 : gapPct > 0;
      const gappedThroughStop =
        finite(row.stop) && (isLong ? open <= row.stop : open >= row.stop);
      const refuted = adverse && (gappedThroughStop || Math.abs(gapPct) >= CATALYST_ADVERSE_GAP_PCT);
      factors.push({
        label: "catalyst",
        verdict: refuted ? "refuted" : "confirmed",
        detail: refuted
          ? `flagged ${what}; the session opened ${gapPct}% against the play${gappedThroughStop ? " — through the published stop" : ""} (adverse-gap bar ${CATALYST_ADVERSE_GAP_PCT}%)`
          : `flagged ${what}; the open (${gapPct >= 0 ? "+" : ""}${gapPct}%) did not gap adversely through the plan`,
      });
    } else {
      factors.push({ label: "catalyst", verdict: "untestable", detail: `flagged ${what}; no open/reference price to measure the gap` });
    }
  }

  return factors;
}

// ── Failure-mode classification ─────────────────────────────────────────────────────

/** One PRIMARY tag per graded play. Deterministic precedence (first match wins):
 *   1. pulled            → pulled_wrongly (counterfactual would have won) | pulled_correctly
 *   2. outcome unfilled  → band_detached (band beyond the PR-N3 gate distance, from the
 *                          pin when present else the session's nearest approach)
 *                          | unfilled_never_traded_back
 *   3. outcome target    → gap_win (open already beyond target — legacy-only by
 *                          construction post-#333) | lucky_win (MAE >= 75% of stop
 *                          distance) | clean_win
 *   4. outcome stop      → gap_through_stop (open beyond stop) | wrong_direction
 *                          (MFE < 25% of target distance AND adverse realized close)
 *                          | stopped_normal
 *   5. outcome ambiguous → stopped_normal (both levels traded; graded conservatively —
 *                          detail says so)
 *   6. outcome open      → wrong_direction (closed against the entry) |
 *                          target_unreachable (moved with the play / flat, target still
 *                          out of reach in the one-session horizon)
 *  Pull precedence is deliberate: a pulled play's grade is counterfactual-only (#331),
 *  so its debrief must judge the PULL, not the play. */
export function classifyFailureMode(
  row: DebriefRowLike,
  fill: DebriefFill,
  excursion: DebriefExcursion | null,
  pin: DebriefPinLike | null
): { tag: DebriefFailureMode; detail: string } {
  const isLong = isLongRow(row);
  const bar = sessionBarFromRow(row);

  // 1) Pulled — judge the pull via the counterfactual grade.
  if (row.pulled === true) {
    const won = pulledPlayWouldHaveWon(row);
    const ret = debriefRealizedReturnPct(row);
    const retTxt = ret != null ? ` (counterfactual close-vs-entry ${ret >= 0 ? "+" : ""}${round2(ret)}%)` : "";
    return won
      ? {
          tag: "pulled_wrongly",
          detail: `pulled pre-open (${row.pulled_reason ?? "no reason recorded"}) but the counterfactual grade is ${row.outcome}${retTxt} — the pull cost a winner`,
        }
      : {
          tag: "pulled_correctly",
          detail: `pulled pre-open (${row.pulled_reason ?? "no reason recorded"}); the counterfactual grade is ${row.outcome}${retTxt} — the pull avoided a non-winner`,
        };
  }

  // 2) Unfilled — separate the detached-band class from a near miss.
  if (row.outcome === "unfilled") {
    const edge = fill.fill_edge;
    // Publish-time signature first (the pin is the evidence of record); session-based
    // nearest approach as the fallback for pre-pinning rows.
    const pinnedDist = pin?.band_distance_pct ?? null;
    let approachPct: number | null = null;
    if (edge != null && finite(isLong ? bar.l : bar.h)) {
      approachPct = isLong ? pctOf(edge, bar.l! - edge) : pctOf(edge, edge - bar.h!);
    }
    const detached =
      (pinnedDist != null && Math.abs(pinnedDist) > GATE_BAND_MAX_DISTANCE_PCT) ||
      (pinnedDist == null && approachPct != null && approachPct > GATE_BAND_MAX_DISTANCE_PCT);
    if (detached) {
      return {
        tag: "band_detached",
        detail:
          pinnedDist != null
            ? `the band was pinned ${round2(pinnedDist)}% from spot at publish (gate bar ±${GATE_BAND_MAX_DISTANCE_PCT}%) — structurally unfillable as published`
            : `the session never came within ${approachPct}% of the band edge (gate bar ${GATE_BAND_MAX_DISTANCE_PCT}%) — the band was detached from the tape`,
      };
    }
    return {
      tag: "unfilled_never_traded_back",
      detail: `${fill.detail} — a near-miss no-fill, not a detached band${approachPct != null ? ` (nearest approach ${approachPct}%)` : ""}`,
    };
  }

  // 3) Wins.
  if (row.outcome === "target") {
    const open = bar.o;
    if (finite(open) && finite(row.target) && (isLong ? open >= row.target : open <= row.target)) {
      return {
        tag: "gap_win",
        detail: `the open ${fmt(open)} was already beyond the target ${fmt(row.target)} — a gap-away "win" no member could have entered (should be impossible under v2 fillability grading; legacy taxonomy)`,
      };
    }
    const maeRatio = excursion?.mae_vs_stop_ratio;
    if (maeRatio != null && maeRatio >= LUCKY_WIN_MAE_STOP_FRACTION) {
      return {
        tag: "lucky_win",
        detail: `graded target but the session's worst print consumed ${round2(maeRatio * 100)}% of the stop distance (lucky bar: ${LUCKY_WIN_MAE_STOP_FRACTION * 100}%) — intrabar order unknowable from a daily bar, so this win is never advertised as clean`,
      };
    }
    return {
      tag: "clean_win",
      detail: `filled, reached target${maeRatio != null ? `, and never used more than ${round2(maeRatio * 100)}% of the stop distance` : " (drawdown not measurable — no usable stop distance)"} — a real, fillable winner`,
    };
  }

  // 4) Stops.
  if (row.outcome === "stop") {
    const open = bar.o;
    if (finite(open) && finite(row.stop) && (isLong ? open <= row.stop : open >= row.stop)) {
      const pinnedRef = pin?.prior_close ?? pin?.spot_at_publish ?? null;
      const gapTxt = pinnedRef != null && open != null ? ` (${pctOf(pinnedRef, open - pinnedRef)}% overnight gap)` : "";
      return {
        tag: "gap_through_stop",
        detail: `opened ${fmt(open)} already beyond the published stop ${fmt(row.stop!)}${gapTxt} — the loss was decided before the session, where only a pre-open pull (morning re-compose) can act`,
      };
    }
    const mfeRatio = excursion?.mfe_vs_target_ratio;
    const ret = debriefRealizedReturnPct(row);
    if (mfeRatio != null && mfeRatio < WRONG_DIRECTION_MFE_TARGET_FRACTION && ret != null && ret < 0) {
      return {
        tag: "wrong_direction",
        detail: `stopped having reached only ${round2(mfeRatio * 100)}% of the target distance and closed ${round2(ret)}% against the entry — the direction call itself failed`,
      };
    }
    return {
      tag: "stopped_normal",
      detail: `filled and stopped${mfeRatio != null ? ` after reaching ${round2(mfeRatio * 100)}% of the target distance` : ""} — an ordinary stop-out inside the plan's own risk budget`,
    };
  }

  // 5) Ambiguous — both levels traded; the open decided neither.
  if (row.outcome === "ambiguous") {
    return {
      tag: "stopped_normal",
      detail: "both target and stop traded in the same session and the open decided neither — graded conservatively (never a win); treated as an ordinary stop-class outcome",
    };
  }

  // 6) Open — closed without touching either level.
  const ret = debriefRealizedReturnPct(row);
  if (ret != null && ret < 0) {
    return {
      tag: "wrong_direction",
      detail: `closed ${round2(ret)}% against the entry without reaching either level — the direction call failed inside the one-session horizon`,
    };
  }
  const atrMultiple =
    pin?.atr14 != null && pin.atr14 > 0 && finite(row.target) && fill.fill_edge != null
      ? round2(Math.abs(row.target - fill.fill_edge) / pin.atr14)
      : null;
  return {
    tag: "target_unreachable",
    detail:
      `the session ${ret != null && ret > 0 ? `moved +${round2(ret)}% with the play` : "closed flat"} and the target still never traded` +
      (atrMultiple != null
        ? ` — the target sat ${atrMultiple}× ATR14 from the entry (publish gate bar ${GATE_TARGET_MAX_ATR_MULTIPLE}×)`
        : " — not reachable in the one-session grading horizon"),
  };
}

// ── The per-play post-mortem ────────────────────────────────────────────────────────

/**
 * Debrief ONE graded play. Pure and deterministic: the outcome row (with its pinned
 * publish_context / morning_verdict / pulled state and its persisted grading bar) plus
 * optional intraday bars in, one PlayDebrief out. Returns null for a `pending` row —
 * there is no post-mortem before a grade exists (the cron pass re-visits it next run).
 */
export function debriefPlay(row: DebriefRowLike, intradayBars: DebriefBar[] = []): PlayDebrief | null {
  if (row.outcome === "pending") return null;
  const pin = readDebriefPin(row.publish_context ?? null);
  const fill = computeFill(row, intradayBars);
  const excursion = computeExcursion(row, fill);
  return {
    debrief_version: DEBRIEF_VERSION,
    ticker: String(row.ticker ?? "").toUpperCase(),
    edition_for: row.edition_for,
    direction: isLongRow(row) ? "LONG" : "SHORT",
    conviction: row.conviction ? String(row.conviction).toUpperCase() : null,
    outcome: row.outcome,
    grade_methodology: row.grade_methodology ?? null,
    pulled: row.pulled === true,
    fill,
    excursion,
    thesis: buildThesisScorecard(row, pin, fill),
    failure_mode: classifyFailureMode(row, fill, excursion, pin),
  };
}
