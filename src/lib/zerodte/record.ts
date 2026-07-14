// 0DTE Command multi-day track record (proposal P-3, docs/audit/NIGHTHAWK-VS-SLAYER-0DTE.md §5;
// build item 3 of the decision doc). Until this module, the platform's most ACTIVE play
// surface was the only one whose record members could not see: zerodte_setup_log rows are
// graded per-play (plan_outcome/plan_pnl_pct + direction_hit), but no API aggregated them —
// the board serves today only, and /api/track-record covered Slayer + Night Hawk editions.
//
// Pure functions over already-fetched ledger rows (the route does the fetching), so the
// aggregation math is unit-tested against fixture ledgers — including the real 7/13 session
// (1W/7L) whose shape motivated the whole audit. Methodology discipline (hard rule from the
// decision doc §3): these are PLAN-OUTCOME grades on option premium (−50%/+100%/15:30 plan) —
// NEVER blend them with SPX Slayer's pnl-points or Night Hawk's stock-move percentages.

import type { ZeroDteSetupLogRow } from "@/lib/db";
import { etMinutesOf } from "./plan";

/** Methodology label served with every payload built here — the honest-record rule. */
export const ZERODTE_RECORD_METHODOLOGY =
  "0DTE Command results are plan-outcome grades against the printed contract plan " +
  "(stop -50% / trim +100% / hard exit 15:30 ET) on the option's own premium, from the " +
  "scanner ledger (every committed setup, no cherry-picking). A win is positive plan P&L. " +
  "These are option-premium returns under a fixed plan — not SPX Slayer point results and " +
  "not Night Hawk stock-move returns; the three methodologies are never blended.";

/** Buckets with fewer graded plays than this are flagged low_n so UIs can badge them —
 *  the forensics rule: never let a 2-sample bucket read like a track record. */
export const LOW_N_THRESHOLD = 5;

export type ZeroDteRecordPlay = {
  session_date: string;
  ticker: string;
  direction: "long" | "short";
  /** ISO first-flag instant + its ET rendering (the desk time members saw it). */
  flagged_at: string;
  flagged_et: string;
  /** Peak evidence score for the session (score_max) — the committed score, when the
   *  row carries entry_context, lives in entry_context.score. */
  score: number;
  conviction: string | null;
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  /** Underlying direction grade (close vs flag) — the separate honesty ledger. */
  direction_hit: boolean | null;
  move_pct: number | null;
  /** Context-at-entry blob once present (C-2) — null on rows older than the column. */
  entry_context: Record<string, unknown> | null;
};

export type ZeroDteRecordBucket = {
  label: string;
  n: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  avg_pnl_pct: number | null;
  /** n < LOW_N_THRESHOLD — UIs must badge these, aggregators must not lean on them. */
  low_n: boolean;
};

export type ZeroDteRecord = {
  methodology: string;
  window: { since: string; through: string; days: number; sessions: number };
  /** Every ledger row in the window (graded or not) — the per-play record. */
  plays: ZeroDteRecordPlay[];
  total_flagged: number;
  /** Rows with a real plan grade (plan_outcome present and not 'ungradeable'). */
  graded: number;
  ungraded: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  avg_pnl_pct: number | null;
  by_outcome: ZeroDteRecordBucket[];
  by_time_of_day: ZeroDteRecordBucket[];
  by_direction: ZeroDteRecordBucket[];
  by_score_band: ZeroDteRecordBucket[];
  available: boolean;
};

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Same graded-row predicate the calibration harness uses (bie/calibration.ts):
 *  'ungradeable' means the plan could not be measured — it is neither W nor L. */
export function isGradedZeroDteRow(row: Pick<ZeroDteSetupLogRow, "plan_outcome">): boolean {
  return row.plan_outcome != null && row.plan_outcome !== "ungradeable";
}

/** Win = positive plan P&L — identical to the calibration harness's definition, so the
 *  member-facing record and the internal calibration can never disagree on what a win is. */
export function isZeroDteWin(row: Pick<ZeroDteSetupLogRow, "plan_pnl_pct">): boolean {
  return (row.plan_pnl_pct ?? 0) > 0;
}

/** The score every score-band gate acted on: commit-time score from entry_context when
 *  the row carries one (C-2 rows), else score_max (pre-context rows — the ratcheted peak,
 *  the same field the calibration harness bands by). */
export function scoreForBanding(
  row: Pick<ZeroDteSetupLogRow, "score_max" | "entry_context">
): number {
  const ctxScore = row.entry_context?.score;
  return typeof ctxScore === "number" && Number.isFinite(ctxScore) ? ctxScore : row.score_max;
}

/** Time-of-day bucket for a first-flag instant. The three RTH windows come from the
 *  decision-doc factor cuts (open-window weakness F-4 / prime / midday / late); "open"
 *  covers 9:30-9:50 and "other" catches anything outside RTH commit hours so no play
 *  is ever silently dropped from the cut. */
export function todBucket(firstFlaggedAt: string): string {
  const m = etMinutesOf(Date.parse(firstFlaggedAt));
  if (m < 9 * 60 + 30) return "other";
  if (m < 9 * 60 + 50) return "open 9:30-9:50";
  if (m < 11 * 60) return "prime 9:50-11:00";
  if (m < 14 * 60) return "midday 11:00-14:00";
  if (m <= 15 * 60 + 30) return "late 14:00-15:30";
  return "other";
}

export function scoreBand(score: number): string {
  // Band edges match the engine's own calibration finding (F-2): 55-64 is the
  // below-breakeven band; 65 is the proposed commit floor (gate G-3).
  if (score >= 65) return "score 65+";
  if (score >= 55) return "score 55-64";
  return "score <55";
}

/** Deterministic bucket ordering so payloads (and their tests) never depend on
 *  Map insertion order of whatever the ledger happened to contain. */
const BUCKET_ORDER: Record<string, number> = {
  // by_outcome
  doubled: 0,
  stopped: 1,
  time_stop: 2,
  // by_time_of_day
  "open 9:30-9:50": 0,
  "prime 9:50-11:00": 1,
  "midday 11:00-14:00": 2,
  "late 14:00-15:30": 3,
  other: 4,
  // by_direction
  long: 0,
  short: 1,
  // by_score_band
  "score 65+": 0,
  "score 55-64": 1,
  "score <55": 2,
};

function bucketize(
  rows: ZeroDteSetupLogRow[],
  label: (r: ZeroDteSetupLogRow) => string
): ZeroDteRecordBucket[] {
  const groups = new Map<string, ZeroDteSetupLogRow[]>();
  for (const r of rows) {
    const key = label(r);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return Array.from(groups.entries())
    .map(([lbl, group]) => {
      const wins = group.filter(isZeroDteWin).length;
      const pnls = group.map((r) => r.plan_pnl_pct).filter((p): p is number => p != null);
      return {
        label: lbl,
        n: group.length,
        wins,
        losses: group.length - wins,
        win_rate_pct: group.length > 0 ? round1((wins / group.length) * 100) : null,
        avg_pnl_pct: pnls.length ? round2(pnls.reduce((a, b) => a + b, 0) / pnls.length) : null,
        low_n: group.length < LOW_N_THRESHOLD,
      };
    })
    .sort(
      (a, b) =>
        (BUCKET_ORDER[a.label] ?? 99) - (BUCKET_ORDER[b.label] ?? 99) ||
        a.label.localeCompare(b.label)
    );
}

function toPlay(r: ZeroDteSetupLogRow): ZeroDteRecordPlay {
  const flaggedMs = Date.parse(r.first_flagged_at);
  const m = Number.isFinite(flaggedMs) ? etMinutesOf(flaggedMs) : null;
  const flaggedEt =
    m != null
      ? `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")} ET`
      : "";
  return {
    session_date: r.session_date,
    ticker: r.ticker,
    direction: r.direction,
    flagged_at: r.first_flagged_at,
    flagged_et: flaggedEt,
    score: r.score_max,
    conviction: r.conviction,
    plan_outcome: r.plan_outcome,
    plan_pnl_pct: r.plan_pnl_pct != null ? round2(r.plan_pnl_pct) : null,
    direction_hit: r.direction_hit,
    move_pct: r.move_pct != null ? round2(r.move_pct) : null,
    entry_context: r.entry_context,
  };
}

/**
 * Build the multi-day record from ledger rows (any order). Aggregates run over GRADED
 * rows only; ungraded rows (today's live session, or backfill-pending index roots) still
 * appear in `plays` with null grades — present but never counted, the same provisional
 * discipline the forensics applied to 7/13's live ledger.
 */
export function buildZeroDteRecord(
  rows: ZeroDteSetupLogRow[],
  window: { since: string; through: string; days: number }
): ZeroDteRecord {
  const sorted = [...rows].sort(
    (a, b) => b.session_date.localeCompare(a.session_date) || a.ticker.localeCompare(b.ticker)
  );
  const graded = sorted.filter(isGradedZeroDteRow);
  const wins = graded.filter(isZeroDteWin).length;
  const pnls = graded.map((r) => r.plan_pnl_pct).filter((p): p is number => p != null);
  const sessions = new Set(sorted.map((r) => r.session_date)).size;

  return {
    methodology: ZERODTE_RECORD_METHODOLOGY,
    window: { ...window, sessions },
    plays: sorted.map(toPlay),
    total_flagged: sorted.length,
    graded: graded.length,
    ungraded: sorted.length - graded.length,
    wins,
    losses: graded.length - wins,
    win_rate_pct: graded.length > 0 ? round1((wins / graded.length) * 100) : null,
    avg_pnl_pct: pnls.length ? round2(pnls.reduce((a, b) => a + b, 0) / pnls.length) : null,
    by_outcome: bucketize(graded, (r) => r.plan_outcome ?? "ungraded"),
    by_time_of_day: bucketize(graded, (r) => todBucket(r.first_flagged_at)),
    by_direction: bucketize(graded, (r) => r.direction),
    by_score_band: bucketize(graded, (r) => scoreBand(scoreForBanding(r))),
    available: graded.length > 0,
  };
}
