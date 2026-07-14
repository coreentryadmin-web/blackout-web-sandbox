// Counterfactual SKIP grading (PR-C) — what did the hard gates COST us?
//
// The hard gate stack (G-1/G-2/G-3/G-5, ./gates.ts) persists every block to
// zerodte_scan_rejections, which makes blocked plays visible — but not measurable:
// a gate that blocks LOSERS and a gate that blocks WINNERS write identical rows.
// The forensic priors cut both ways (F-1: the 17-20 VIX regime ran 25% WR — but the
// 15-17 regime ran 69%, so a crude VIX block would have amputated the winners too),
// so calibration needs the counterfactual: for each rejection, what would the play
// have DONE if it had committed?
//
// Honesty rules (non-negotiable, same discipline as record.ts / plan.ts):
// - Premium P&L is computed ONLY when the actual contract path is reconstructable
//   (an OCC symbol pinned on the rejection). Rejection rows today carry no OCC —
//   the play was blocked before a plan printed — so those grade UNDERLYING-direction
//   only, labeled basis:"underlying". Premium P&L is never fabricated from a stock
//   move.
// - Entry is the first REAL bar at/after the block time — never the rejection's own
//   metrics, never an interpolation.
// - Same plan rules as committed plays (PLAN_RULES: stop -50 / target +100 / hard
//   exit 15:30 ET), graded by the same walker (gradePlanFromBars) so a blocked play
//   and a committed play can never be scored under different physics.
// - Ties are conservative AGAINST the counterfactual: a bar that touches stop AND
//   target grades as the stop (gradePlanFromBars' own rule — intrabar order is
//   unknowable), and a dead-flat underlying move is would_have_lost. Inflating
//   "blocked value" would pressure gates open on fabricated evidence — the failure
//   mode this whole loop exists to prevent.
// - Nothing reconstructable → verdict "ungradeable" WITH the reason, persisted, so
//   the same row is never re-ground every run and the gap is visible, not silent.
//
// Pure core (gradeSkippedPlay) + data layer (runSkipGrading / fetchGradedSkips) —
// the data layer uses dynamic RELATIVE imports so the pure core's import graph
// stays provider-free for tests (and because CI's tsx ESM loader cannot resolve
// "@/" aliases in dynamic import positions).

import { PLAN_RULES, etMinutesOf, gradePlanFromBars, type PlanBar } from "./plan";
import { polygonSpotTicker } from "./board";

export const SKIP_GRADE_VERSION = 1;

/** Bar shape the grader consumes — PlanBar plus nothing (o is unused: entry is the
 *  first bar's CLOSE, a level that provably printed by the time it was knowable). */
export type SkipGradeBar = PlanBar;

export type SkipCounterfactual = {
  version: typeof SKIP_GRADE_VERSION;
  /** "premium" only when the contract's own bars were walked; "underlying" for the
   *  direction-only grade; null when ungradeable. */
  basis: "premium" | "underlying" | null;
  verdict: "would_have_won" | "would_have_lost" | "ungradeable";
  /** Plan outcome (premium basis only) — same vocabulary as the ledger's plan_outcome. */
  outcome: "doubled" | "stopped" | "time_stop" | null;
  /** Premium P&L % under PLAN_RULES (premium basis only — NEVER set on underlying basis). */
  pnl_pct: number | null;
  entry: number | null;
  exit: number | null;
  /** Underlying move % entry→exit (underlying basis only). */
  move_pct: number | null;
  reason: string | null;
  graded_at: string;
};

const round2 = (v: number): number => Math.round(v * 100) / 100;

function ungradeable(reason: string, nowMs: number): SkipCounterfactual {
  return {
    version: SKIP_GRADE_VERSION,
    basis: null,
    verdict: "ungradeable",
    outcome: null,
    pnl_pct: null,
    entry: null,
    exit: null,
    move_pct: null,
    reason,
    graded_at: new Date(nowMs).toISOString(),
  };
}

/** First usable bar at/after the block time that is still inside the plan window
 *  (a block at 15:40 has no window — 0DTE has no tomorrow). */
function entryBarOf(bars: SkipGradeBar[], blockedAtMs: number): SkipGradeBar | null {
  for (const bar of [...bars].sort((a, b) => a.t - b.t)) {
    if (bar.t < blockedAtMs) continue;
    if (etMinutesOf(bar.t) > PLAN_RULES.time_stop_et_minutes) return null;
    if (Number.isFinite(bar.c) && bar.c > 0) return bar;
  }
  return null;
}

/**
 * Grade ONE skipped play counterfactually. Pure and deterministic: bars in, verdict
 * out; `nowMs` is a parameter (stamped into graded_at, never read from a clock).
 *
 * Entry = the CLOSE of the first bar at/after `blockedAtMs` — the first mark that
 * had provably printed by the time anyone could have acted on the block — and the
 * plan rules are applied to STRICTLY SUBSEQUENT bars (the entry bar's own high/low
 * happened around the entry print in unknowable order; letting it trigger the stop
 * or target would be intrabar clairvoyance in either direction).
 */
export function gradeSkippedPlay(input: {
  direction: string | null;
  /** Epoch-ms of the block (the rejection row's observed_at). */
  blockedAtMs: number;
  /** Contract minute bars — only when the rejection pinned a real OCC. */
  premiumBars?: SkipGradeBar[] | null;
  /** Underlying minute bars (polygonSpotTicker mapping applied by the caller). */
  underlyingBars?: SkipGradeBar[] | null;
  nowMs: number;
}): SkipCounterfactual {
  const { blockedAtMs, nowMs } = input;
  const direction = input.direction === "long" || input.direction === "short" ? input.direction : null;
  if (direction == null) {
    return ungradeable("no long/short direction on the rejection row — the play cannot be reconstructed", nowMs);
  }
  if (!Number.isFinite(blockedAtMs)) {
    return ungradeable("block time unreadable — no counterfactual entry point exists", nowMs);
  }
  if (etMinutesOf(blockedAtMs) > PLAN_RULES.time_stop_et_minutes) {
    return ungradeable("blocked after the 15:30 ET hard exit — no plan window existed to grade", nowMs);
  }

  // Premium basis — only when the actual contract's bars are in hand.
  const premiumBars = input.premiumBars ?? [];
  if (premiumBars.length > 0) {
    const entryBar = entryBarOf(premiumBars, blockedAtMs);
    if (entryBar != null) {
      const entry = entryBar.c;
      // +1ms: gradePlanFromBars includes bars with t >= flaggedAt, and the entry
      // bar itself must be excluded (see the function doc above).
      const grade = gradePlanFromBars(premiumBars, entry, entryBar.t + 1);
      if (grade.outcome !== "ungradeable") {
        return {
          version: SKIP_GRADE_VERSION,
          basis: "premium",
          verdict: (grade.pnl_pct ?? 0) > 0 ? "would_have_won" : "would_have_lost",
          outcome: grade.outcome,
          pnl_pct: grade.pnl_pct,
          entry: round2(entry),
          exit: grade.pnl_pct != null ? round2(entry * (1 + grade.pnl_pct / 100)) : null,
          move_pct: null,
          reason: null,
          graded_at: new Date(nowMs).toISOString(),
        };
      }
    }
    // Contract bars exist but none after a usable entry — fall through to the
    // underlying basis rather than fabricating a premium grade.
  }

  // Underlying-direction basis — the honest fallback when no contract path exists.
  const underlyingBars = input.underlyingBars ?? [];
  if (underlyingBars.length === 0) {
    return ungradeable(
      premiumBars.length > 0
        ? "contract bars end at/before the counterfactual entry and no underlying bars were available"
        : "no bar data available for the session — neither contract nor underlying path reconstructable",
      nowMs
    );
  }
  const entryBar = entryBarOf(underlyingBars, blockedAtMs);
  if (entryBar == null) {
    return ungradeable("no underlying bar at/after the block time inside the plan window", nowMs);
  }
  let exit: number | null = null;
  for (const bar of [...underlyingBars].sort((a, b) => a.t - b.t)) {
    if (bar.t <= entryBar.t) continue;
    if (etMinutesOf(bar.t) > PLAN_RULES.time_stop_et_minutes) break;
    if (Number.isFinite(bar.c) && bar.c > 0) exit = bar.c;
  }
  if (exit == null) {
    return ungradeable("no underlying bars after the counterfactual entry — no move to measure", nowMs);
  }
  const entry = entryBar.c;
  // Strict inequality: a dead-flat move is would_have_lost — conservative against
  // the counterfactual (see the module doc's tie rule). Premium P&L stays null:
  // never derived from a stock move.
  const won = direction === "long" ? exit > entry : exit < entry;
  return {
    version: SKIP_GRADE_VERSION,
    basis: "underlying",
    verdict: won ? "would_have_won" : "would_have_lost",
    outcome: null,
    pnl_pct: null,
    entry: round2(entry),
    exit: round2(exit),
    move_pct: round2(((exit - entry) / entry) * 100),
    reason: null,
    graded_at: new Date(nowMs).toISOString(),
  };
}

// ── Data layer ───────────────────────────────────────────────────────────────────

/** Bounded run window — the grader is admin-invoked and per-row does a Polygon
 *  minute-bar fetch, so the range is capped hard. */
export const MAX_SKIP_GRADE_DAYS = 14;
/** Row cap per run — with the per-(ticker,session) bar cache below, distinct
 *  fetches are far fewer, but the UPDATE loop stays bounded regardless. */
const MAX_ROWS_PER_RUN = 200;

function etYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}

// counterfactual_json migration — the same idempotent ALTER-IF-NOT-EXISTS pattern
// db.ts uses for zerodte_setup_log.entry_context / gate_calibration_json, executed
// lazily from HERE (memoized per process) instead of db.ts's ensureSchema block so
// this PR stays new-files-only (db.ts is under concurrent edit by another agent).
// Additive nullable JSONB: rows older than the column carry NULL forever, exactly
// like entry_context — consumers must treat it as optional.
let counterfactualColumnReady: Promise<void> | null = null;
async function ensureCounterfactualColumn(): Promise<void> {
  if (counterfactualColumnReady == null) {
    counterfactualColumnReady = (async () => {
      const db = await import("../db");
      await db.dbQuery(
        "ALTER TABLE zerodte_scan_rejections ADD COLUMN IF NOT EXISTS counterfactual_json JSONB"
      );
    })().catch((err) => {
      // Reset the memo so a transient failure retries on the next call instead of
      // poisoning every future run of this process.
      counterfactualColumnReady = null;
      throw err;
    });
  }
  return counterfactualColumnReady;
}

export type SkipGradingSummary = {
  available: boolean;
  since: string;
  /** Exclusive upper bound — the live ET session is never graded mid-day (same
   *  finished-sessions-only discipline as gradeZeroDteLedger). */
  through_exclusive: string;
  scanned: number;
  graded: number;
  ungradeable: number;
  errors: number;
  note?: string;
};

type UngradedRejectionRow = {
  id: number;
  observed_at: string;
  session_date: string;
  ticker: string;
  gate_failed: string;
  direction: string | null;
};

/**
 * Grade every not-yet-graded rejection in the window and persist the verdict onto
 * the row (counterfactual_json). Bounded (≤MAX_SKIP_GRADE_DAYS days, ≤MAX_ROWS_PER_RUN
 * rows), idempotent (graded rows are excluded by the WHERE clause), fail-soft (a
 * per-row failure is counted and skipped, never thrown). `nowMs` is a parameter.
 */
export async function runSkipGrading(opts: { days?: number; nowMs: number }): Promise<SkipGradingSummary> {
  const days = Math.min(MAX_SKIP_GRADE_DAYS, Math.max(1, Math.trunc(opts.days ?? MAX_SKIP_GRADE_DAYS)));
  const today = etYmd(opts.nowMs);
  const since = etYmd(opts.nowMs - days * 24 * 60 * 60 * 1000);
  const base: SkipGradingSummary = {
    available: false,
    since,
    through_exclusive: today,
    scanned: 0,
    graded: 0,
    ungradeable: 0,
    errors: 0,
  };

  let db: typeof import("../db");
  try {
    db = await import("../db");
    if (!db.dbConfigured()) return { ...base, note: "database not configured" };
    await ensureCounterfactualColumn();
  } catch (err) {
    return { ...base, note: `schema/connection unavailable: ${err instanceof Error ? err.message : "error"}` };
  }

  let rows: UngradedRejectionRow[];
  try {
    const res = await db.dbQuery(
      `SELECT id, observed_at, session_date, ticker, gate_failed, direction
         FROM zerodte_scan_rejections
        WHERE counterfactual_json IS NULL
          AND session_date >= $1
          AND session_date < $2
        ORDER BY observed_at ASC
        LIMIT $3`,
      [since, today, MAX_ROWS_PER_RUN]
    );
    rows = res.rows.map((r) => ({
      id: Number(r.id),
      observed_at: String(r.observed_at),
      // session_date arrives as a Date object from pg — normalize to ET YYYY-MM-DD.
      session_date:
        r.session_date instanceof Date ? etYmd(r.session_date.getTime()) : String(r.session_date).slice(0, 10),
      ticker: String(r.ticker),
      gate_failed: String(r.gate_failed),
      direction: r.direction != null ? String(r.direction) : null,
    }));
  } catch (err) {
    return { ...base, note: `rejection fetch failed: ${err instanceof Error ? err.message : "error"}` };
  }

  // One underlying bar fetch per (ticker, session) — many rejections share a name/day.
  const barCache = new Map<string, Promise<SkipGradeBar[]>>();
  const barsFor = (ticker: string, sessionDate: string): Promise<SkipGradeBar[]> => {
    const key = `${ticker}:${sessionDate}`;
    let cached = barCache.get(key);
    if (cached == null) {
      cached = (async () => {
        // Dynamic RELATIVE import (never "@/" — CI's tsx loader can't resolve the
        // alias in dynamic positions): keeps the provider out of the static graph.
        const { fetchAggBars } = await import("../providers/polygon-largo");
        const bars = await fetchAggBars(polygonSpotTicker(ticker), 1, "minute", sessionDate, sessionDate, "50000");
        return bars
          .filter((b) => b.t != null && Number.isFinite(b.t))
          .map((b) => ({ t: b.t as number, h: b.h, l: b.l, c: b.c }));
      })().catch(() => [] as SkipGradeBar[]);
      barCache.set(key, cached);
    }
    return cached;
  };

  const summary = { ...base, available: true };
  for (const row of rows) {
    summary.scanned += 1;
    try {
      // No OCC exists on rejection rows (the play was blocked before a plan
      // printed a contract) — premiumBars stays null and every DB-sourced grade is
      // underlying-basis. The pure core still supports the premium path so a
      // future occ-carrying rejection (or a test fixture) grades on real premium.
      const verdict = gradeSkippedPlay({
        direction: row.direction,
        blockedAtMs: Date.parse(row.observed_at),
        premiumBars: null,
        underlyingBars: await barsFor(row.ticker, row.session_date),
        nowMs: opts.nowMs,
      });
      await db.dbQuery("UPDATE zerodte_scan_rejections SET counterfactual_json = $1 WHERE id = $2", [
        JSON.stringify(verdict),
        row.id,
      ]);
      if (verdict.verdict === "ungradeable") summary.ungradeable += 1;
      else summary.graded += 1;
    } catch {
      // Leave the row ungraded (counterfactual_json stays NULL) — the next run
      // retries it; one bad row never aborts the batch.
      summary.errors += 1;
    }
  }
  return summary;
}

/** Read the already-graded skips for the calibration report's blocked-value lines.
 *  Fail-soft: any failure (missing column included — pre-first-run deployments)
 *  returns [], never a throw into the report builder. */
export async function fetchGradedSkips(opts: {
  sinceYmd: string;
  throughYmd: string;
  limit?: number;
}): Promise<Array<{ gate_failed: string; counterfactual: unknown }>> {
  try {
    const db = await import("../db");
    if (!db.dbConfigured()) return [];
    const res = await db.dbQuery(
      `SELECT gate_failed, counterfactual_json
         FROM zerodte_scan_rejections
        WHERE counterfactual_json IS NOT NULL
          AND session_date >= $1
          AND session_date <= $2
        ORDER BY observed_at DESC
        LIMIT $3`,
      [opts.sinceYmd, opts.throughYmd, Math.min(2000, Math.max(1, opts.limit ?? 2000))]
    );
    return res.rows.map((r) => ({
      gate_failed: String(r.gate_failed),
      counterfactual: r.counterfactual_json,
    }));
  } catch {
    return [];
  }
}
