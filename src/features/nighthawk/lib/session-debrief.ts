// PR-N10 (the automated end-of-session DEBRIEF) — the SESSION-level roll-up.
//
// WHY THIS EXISTS: #337 shipped the per-play forensic post-mortem (debrief.ts,
// `debriefPlay`) and the rolling-window aggregate (debrief-aggregate.ts). What the product
// owner asked for on top of those is a single, automated, per-SESSION artifact — "what went
// well, real winners, what misfired, how to improve" for THIS trading day — pinned immutably
// so a member (and the desk) can open one session's honest debrief and read it cold.
//
// This module is the pure builder for that artifact. It consumes the session's already-
// graded outcome rows (each carrying its pinned publish_context / morning_verdict / grading
// bar) and folds them into four evidence-only buckets. It invents NOTHING:
//   - every winner / loser / P&L number is the RECORD-GRADED outcome, re-derived through the
//     SAME pure `debriefPlay` classifier the row was pinned with (no counterfactual inflation);
//   - the carrying evidence for a winner is the cortex-overnight SUPPORT sources actually
//     pinned at publish (publish_context.cortex_overnight.supports) — read structurally,
//     never guessed;
//   - the WHY for a misfire is that play's own failure-mode detail (from debriefPlay) plus the
//     morning-confirm reason string it was judged by (morning_verdict.reason / pulled_reason);
//   - "how to improve" carries DETERMINISTIC, evidence-COUNTED observations only. Session-local
//     observations are ALWAYS low-N (one session is a handful of plays) so they never mint an
//     actionable suggestion; the actionable, properly-powered patterns ride in `window_patterns`,
//     which the cron fills from the tested rolling aggregate (debrief-aggregate.ts).
//
// HONESTY GATES (same spine as debrief-aggregate.ts):
//   - #333 anti-blend: ONLY current-methodology graded rows are bucketed; legacy-graded rows
//     are counted (`legacy_excluded`) and never scored.
//   - LOW-N discipline: the session win-rate and every session observation carry `low_n`;
//     an observation under n=LOW_N_THRESHOLD NEVER produces a suggestion (suggestion: null).
//   - No fabricated win-rates / probabilities: win_rate is null when there is nothing
//     scoreable, and realized returns are the resolved close-vs-band-mid the record grades on.
//
// Pure module: no I/O, no clock, no db imports at runtime (the row type import is type-only).
// The cron (nighthawk-debrief/route.ts) supplies the rows + window patterns and pins the blob.

import {
  debriefPlay,
  debriefRealizedReturnPct,
  type DebriefRowLike,
  type DebriefFailureMode,
} from "./debrief";
import type { DebriefImprovementItem } from "./debrief-aggregate";
import { isCurrentGradeMethodology } from "./grade-methodology";
// The one platform-wide LOW-N disclosure threshold (zerodte/record.ts) — the SAME flag the
// 0DTE calibration report, the NH record cuts, and debrief-aggregate.ts already lean on.
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";

/** Bump when the pinned session-debrief shape changes so member/admin reads can segment. */
export const SESSION_DEBRIEF_VERSION = 1;

// ── Input ─────────────────────────────────────────────────────────────────────────────

/** The outcome-row slice the session debrief reads — a superset of DebriefRowLike so the
 *  same fixtures work, and `debriefPlay` (which reads only DebriefRowLike fields) can run
 *  directly on each row. */
export type SessionDebriefRow = DebriefRowLike;

// ── Output shapes ───────────────────────────────────────────────────────────────────────

/** A play that resolved a real winner, with the pinned evidence that carried it. */
export type WentWellItem = {
  ticker: string;
  direction: "LONG" | "SHORT";
  conviction: string | null;
  outcome: string;
  failure_mode: DebriefFailureMode;
  /** cortex-overnight SUPPORT source ids pinned at publish (the evidence that carried it). */
  carried_by: string[];
  detail: string;
};

/** The honest numeric ledger of a real, fillable winner — record-graded, no inflation. */
export type RealWinnerItem = {
  ticker: string;
  direction: "LONG" | "SHORT";
  conviction: string | null;
  outcome: string;
  /** Close vs published entry-mid, direction-signed % (the record's realized number). */
  realized_return_pct: number | null;
  /** Max favorable excursion from the conservative fill, signed % (null when unmeasurable). */
  mfe_pct: number | null;
  detail: string;
};

/** How we classify a misfire — the "thesis wrong" vs "thesis right, price/execution stopped
 *  it" distinction the owner asked for, plus the honest structural buckets that are neither. */
export type MisfireClass =
  | "thesis_wrong" // the direction call itself failed (wrong_direction / target beyond horizon)
  | "thesis_right_execution" // right idea, ordinary in-plan stop-out
  | "gapped_pre_open" // decided by an overnight gap through the stop, before the session
  | "structural_band" // the published band was detached from the tape (never fillable)
  | "no_fill" // near-miss: the band never traded, not detached
  | "pull_removed_winner"; // the morning pull latch removed a play that would have won

export type MisfireItem = {
  ticker: string;
  direction: "LONG" | "SHORT";
  conviction: string | null;
  outcome: string;
  pulled: boolean;
  failure_mode: DebriefFailureMode;
  misfire_class: MisfireClass;
  /** The play's own failure-mode detail (from debriefPlay) — the deterministic WHY. */
  why: string;
  /** The morning-confirm verdict/reason (or pull reason) this play was judged by, when one
   *  was pinned; null for a play that never reached a morning verdict. */
  morning_note: string | null;
};

/** One deterministic, evidence-counted observation. `suggestion` is NULL whenever `low_n`
 *  is true — the LOW-N discipline in executable form (visible, but never actionable on thin
 *  evidence). */
export type SessionObservation = {
  signal: string;
  observation: string;
  evidence: { n: number };
  suggestion: string | null;
  low_n: boolean;
};

export type SessionDebrief = {
  session_debrief_version: typeof SESSION_DEBRIEF_VERSION;
  edition_for: string;
  /** Stamped by the cron when it pins (the pure builder leaves it undefined). */
  generated_at?: string;
  /** Current-methodology graded rows in this session (the anti-blend base). */
  plays_graded: number;
  /** Graded rows excluded for non-current grade methodology (#333 quarantine). */
  legacy_excluded: number;
  what_went_well: WentWellItem[];
  real_winners: RealWinnerItem[];
  what_misfired: MisfireItem[];
  how_to_improve: {
    /** Session-local, evidence-counted, ALWAYS low-N (never actionable). */
    session_observations: SessionObservation[];
    /** Properly-powered rolling-window patterns from debrief-aggregate.ts — filled by the
     *  cron. Optional so a builder-only call (tests) is complete without it. */
    window_patterns?: DebriefImprovementItem[];
  };
  summary: {
    winners: number;
    losers: number;
    unfilled: number;
    pulled: number;
    /** Excludes unfilled + pulled (same denominator rule as analytics.ts). */
    scoreable: number;
    win_rate_pct: number | null;
    low_n: boolean;
  };
  /** false ⇒ no current-methodology graded plays for this session yet (read route 200s). */
  available: boolean;
};

// ── Taxonomy → bucket maps ──────────────────────────────────────────────────────────────

/** Graded WIN tags. `gap_win` is a legacy-only tag (an unenterable gap-away "win") — counted
 *  as a win for the record but deliberately kept OUT of `real_winners` (no member could have
 *  entered it). */
const WINNER_MODES: ReadonlySet<DebriefFailureMode> = new Set<DebriefFailureMode>([
  "clean_win",
  "lucky_win",
  "gap_win",
]);

/** Failure modes that constitute a MISFIRE (a loss, a structural non-fill, or a wrong pull),
 *  each mapped to its honest class. `pulled_correctly` is deliberately absent — a pull that
 *  avoided a non-winner is the system working, surfaced in session_observations, not a misfire. */
const MISFIRE_CLASS: Partial<Record<DebriefFailureMode, MisfireClass>> = {
  wrong_direction: "thesis_wrong",
  target_unreachable: "thesis_wrong",
  stopped_normal: "thesis_right_execution",
  gap_through_stop: "gapped_pre_open",
  band_detached: "structural_band",
  unfilled_never_traded_back: "no_fill",
  pulled_wrongly: "pull_removed_winner",
};

// ── Structural readers (never trust a JSONB column) ─────────────────────────────────────

/** cortex-overnight SUPPORT source ids pinned at publish — the evidence that carried a play.
 *  Reads structurally from publish_context.cortex_overnight.supports; anything malformed or
 *  pre-N5 degrades to [] (no fabricated evidence). */
export function cortexSupportSources(publishContext: unknown): string[] {
  if (publishContext == null || typeof publishContext !== "object" || Array.isArray(publishContext)) {
    return [];
  }
  const cortex = (publishContext as Record<string, unknown>).cortex_overnight;
  if (cortex == null || typeof cortex !== "object") return [];
  const supports = (cortex as Record<string, unknown>).supports;
  if (!Array.isArray(supports)) return [];
  const out: string[] = [];
  for (const s of supports) {
    if (s != null && typeof s === "object") {
      const src = (s as Record<string, unknown>).source;
      if (typeof src === "string" && src.length > 0) out.push(src);
    }
  }
  return Array.from(new Set(out));
}

/** The morning-confirm verdict + reason this play was judged by, as one honest note; the
 *  pull reason is the fallback (a pulled play always has one). Null when nothing was pinned. */
export function morningNote(row: SessionDebriefRow): string | null {
  const mv = row.morning_verdict;
  if (mv != null && typeof mv === "object" && !Array.isArray(mv)) {
    const rec = mv as Record<string, unknown>;
    const reason = typeof rec.reason === "string" && rec.reason.length > 0 ? rec.reason : null;
    const status = typeof rec.status === "string" && rec.status.length > 0 ? rec.status : null;
    if (reason) return status ? `${status}: ${reason}` : reason;
    if (status) return status;
  }
  return typeof row.pulled_reason === "string" && row.pulled_reason.length > 0 ? row.pulled_reason : null;
}

// ── Small helpers ─────────────────────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;

function directionOf(row: SessionDebriefRow): "LONG" | "SHORT" {
  return row.direction === "SHORT" ? "SHORT" : "LONG";
}

function convictionOf(row: SessionDebriefRow): string | null {
  return row.conviction ? String(row.conviction).toUpperCase() : null;
}

// ── The builder ─────────────────────────────────────────────────────────────────────────

/**
 * Build ONE session's debrief from its graded outcome rows. Pure and deterministic: the
 * session's rows in (each with its pinned publish_context / morning_verdict / grading bar),
 * one SessionDebrief out. `window_patterns` (the rolling-aggregate improvement queue) is
 * passed through untouched when supplied — the cron owns that fetch.
 *
 * Only CURRENT-methodology graded rows are bucketed (#333 anti-blend); pending and legacy
 * rows are excluded from every score (legacy counted in `legacy_excluded`).
 */
export function buildSessionDebrief(input: {
  editionFor: string;
  rows: SessionDebriefRow[];
  windowPatterns?: DebriefImprovementItem[];
}): SessionDebrief {
  const graded = input.rows.filter((r) => r.outcome !== "pending");
  const legacy = graded.filter((r) => !isCurrentGradeMethodology(r.grade_methodology));
  const current = graded.filter((r) => isCurrentGradeMethodology(r.grade_methodology));

  const wentWell: WentWellItem[] = [];
  const realWinners: RealWinnerItem[] = [];
  const misfires: MisfireItem[] = [];

  // Per-play pass — every classification comes from the SAME pure debriefPlay the row was
  // pinned with, re-derived here from the row's own grading inputs (never re-fetched).
  for (const row of current) {
    const play = debriefPlay(row);
    if (play == null) continue; // pending guard (already filtered, belt-and-suspenders)
    const mode = play.failure_mode.tag;
    const pulled = row.pulled === true;

    if (WINNER_MODES.has(mode) && !pulled) {
      wentWell.push({
        ticker: play.ticker,
        direction: play.direction,
        conviction: play.conviction,
        outcome: String(row.outcome),
        failure_mode: mode,
        carried_by: cortexSupportSources(row.publish_context ?? null),
        detail: play.failure_mode.detail,
      });
      // Real winners = fillable, enterable wins only (gap_win is unenterable — excluded).
      if (mode !== "gap_win") {
        const realized = debriefRealizedReturnPct(row);
        realWinners.push({
          ticker: play.ticker,
          direction: play.direction,
          conviction: play.conviction,
          outcome: String(row.outcome),
          realized_return_pct: realized != null ? round2(realized) : null,
          mfe_pct: play.excursion?.mfe_pct ?? null,
          detail: play.excursion?.detail ?? play.failure_mode.detail,
        });
      }
      continue;
    }

    const misfireClass = MISFIRE_CLASS[mode];
    if (misfireClass) {
      misfires.push({
        ticker: play.ticker,
        direction: play.direction,
        conviction: play.conviction,
        outcome: String(row.outcome),
        pulled,
        failure_mode: mode,
        misfire_class: misfireClass,
        why: play.failure_mode.detail,
        morning_note: morningNote(row),
      });
    }
    // pulled_correctly (and any not-yet-mapped tag) falls through — surfaced in observations,
    // never silently counted as a misfire.
  }

  // Stable ordering so the pinned blob is byte-deterministic for a given input.
  wentWell.sort((a, b) => a.ticker.localeCompare(b.ticker));
  realWinners.sort((a, b) => (b.realized_return_pct ?? -Infinity) - (a.realized_return_pct ?? -Infinity) || a.ticker.localeCompare(b.ticker));
  misfires.sort((a, b) => a.misfire_class.localeCompare(b.misfire_class) || a.ticker.localeCompare(b.ticker));

  // ── Summary (same denominator rules as analytics.ts / debrief-aggregate.ts) ──
  const scoreableRows = current.filter((r) => r.outcome !== "unfilled" && r.pulled !== true);
  const winners = scoreableRows.filter((r) => r.outcome === "target").length;
  const losers = scoreableRows.filter((r) => r.outcome === "stop").length;
  const unfilled = current.filter((r) => r.outcome === "unfilled").length;
  const pulled = current.filter((r) => r.pulled === true).length;
  const scoreable = scoreableRows.length;
  const lowN = scoreable < LOW_N_THRESHOLD;

  return {
    session_debrief_version: SESSION_DEBRIEF_VERSION,
    edition_for: input.editionFor,
    plays_graded: current.length,
    legacy_excluded: legacy.length,
    what_went_well: wentWell,
    real_winners: realWinners,
    what_misfired: misfires,
    how_to_improve: {
      session_observations: buildSessionObservations(current, misfires),
      ...(input.windowPatterns ? { window_patterns: input.windowPatterns } : {}),
    },
    summary: {
      winners,
      losers,
      unfilled,
      pulled,
      scoreable,
      win_rate_pct: scoreable > 0 ? Math.round((winners / scoreable) * 1000) / 10 : null,
      low_n: lowN,
    },
    available: current.length > 0,
  };
}

// ── Session-local observations (deterministic, evidence-counted, ALWAYS low-N-guarded) ──

/** Session observations are computed over ONE session — a handful of plays — so they are
 *  low-N by construction and never mint a suggestion. They exist to make the session's own
 *  pattern VISIBLE (e.g. "the pull removed a would-be winner today"); the actionable,
 *  properly-powered levers ride in `window_patterns`. Every item's `n` is a real count and
 *  `low_n` is honest against LOW_N_THRESHOLD. */
export function buildSessionObservations(
  current: SessionDebriefRow[],
  misfires: MisfireItem[]
): SessionObservation[] {
  const items: SessionObservation[] = [];
  const scoreable = current.filter((r) => r.outcome !== "unfilled" && r.pulled !== true).length;
  const sessionLowN = scoreable < LOW_N_THRESHOLD; // one session is essentially always low-N

  // 1) The morning pull removed a would-be winner this session (pulled_wrongly).
  const pullRemovedWinners = misfires.filter((m) => m.misfire_class === "pull_removed_winner");
  if (pullRemovedWinners.length > 0) {
    items.push({
      signal: "session:pull_removed_winner",
      observation: `the morning pull latch removed ${pullRemovedWinners.length} play(s) that would have won this session (${pullRemovedWinners
        .map((m) => m.ticker)
        .join(", ")})`,
      evidence: { n: pullRemovedWinners.length },
      // Session-scoped: never actionable on one day — the INVALIDATED-threshold call is a
      // window decision (see window_patterns / auto-tune-observe).
      suggestion: null,
      low_n: true,
    });
  }

  // 2) Dominant misfire class this session — visible pattern, never actionable at session n.
  if (misfires.length > 0) {
    const counts = new Map<MisfireClass, number>();
    for (const m of misfires) counts.set(m.misfire_class, (counts.get(m.misfire_class) ?? 0) + 1);
    const [topClass, topN] = Array.from(counts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )[0]!;
    items.push({
      signal: `session:dominant_misfire:${topClass}`,
      observation: `${topN} of ${misfires.length} misfire(s) this session were "${topClass}"`,
      evidence: { n: topN },
      suggestion: null,
      low_n: true,
    });
  }

  // 3) Lucky wins this session (a win that consumed most of its stop budget) — a tightness
  //    tell, but never actionable on one session's worth of plays.
  const luckyWins = current.filter((r) => {
    if (r.pulled === true) return false;
    const p = debriefPlay(r);
    return p?.failure_mode.tag === "lucky_win";
  });
  if (luckyWins.length > 0) {
    items.push({
      signal: "session:lucky_wins",
      observation: `${luckyWins.length} winner(s) survived on <25% of their stop budget this session (${luckyWins
        .map((r) => String(r.ticker).toUpperCase())
        .join(", ")}) — entries/stops may be tight`,
      evidence: { n: luckyWins.length },
      suggestion: null,
      low_n: true,
    });
  }

  // Mark the whole session's evidence honestly even if a future observation forgets to.
  return items.map((it) => ({ ...it, low_n: it.low_n || sessionLowN }));
}
