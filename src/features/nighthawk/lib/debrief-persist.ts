// PR-N10 — the Debrief, persistence layer: the two bounded passes the outcomes cron
// runs AFTER grading.
//
//  1. runNighthawkDebriefPass — pin a PlayDebrief (debrief.ts) onto every graded row
//     that doesn't carry one yet. The debrief is computed from the row's OWN persisted
//     grading bar (no provider fetch), so this pass is pure DB work. First-write-wins
//     at the DB layer (pinNighthawkPlayDebrief COALESCE), idempotent by construction
//     (pinned rows never match the work-queue query again).
//  2. runNighthawkRejectionCounterfactuals — grade PR-N3's publish-gate-blocked plays
//     counterfactually on the SAME next-session daily-bar path the real grader uses
//     (fetchStockDailyBars + resolveOutcome), pinned onto the nighthawk_rejected audit
//     row's counterfactual_json. This is the evidence half of "did the gates block
//     value or block losers" (debrief-aggregate.ts's blocked_value lines) — the same
//     skip-grading philosophy as zerodte/skip-grading.ts, including its honesty rules:
//     entry basis is the published band (underlying level-touch, never fabricated
//     option premium), unreconstructable rows persist an explicit `ungradeable` blob
//     WITH the reason (never silently re-ground every run), and ties/unknowns grade
//     conservatively AGAINST the counterfactual (inflated "blocked value" would
//     pressure gates open on fabricated evidence).
//
// FAIL-SOFT, both passes: a per-row failure is counted and skipped; a total failure
// returns ok:false with the reason. NOTHING here can fail the grading run itself —
// the cron route calls these strictly after grading and merges the results into its
// payload as separate honest ledgers (grading health stays grading-only).

import {
  fetchNighthawkDebriefPendingOutcomes,
  fetchNighthawkPublishGateRejections,
  pinNighthawkPlayDebrief,
  setNighthawkRejectionCounterfactual,
  type NighthawkPlayOutcomeRow,
  type NighthawkPublishGateRejectionRow,
} from "@/lib/db";
import { fetchStockDailyBars } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";
import { debriefPlay } from "./debrief";
import { resolveOutcome } from "./play-outcomes";
import { entryRangeMid } from "./entry-range";

// ── Pass 1: pin debriefs onto graded rows ───────────────────────────────────────────

/** Bounded work queue — 60 days covers the whole product history today and any regrade
 *  wave; 200 rows/run keeps a worst-case backlog to a handful of runs. */
export const DEBRIEF_PASS_LOOKBACK_DAYS = 60;
export const DEBRIEF_PASS_MAX_ROWS = 200;

export type NighthawkDebriefPassResult = {
  ok: boolean;
  scanned: number;
  /** Pins written THIS run. */
  pinned: number;
  /** Rows that raced another writer (first-write-wins left the earlier pin). */
  already_pinned: number;
  /** Graded rows debriefPlay declined (should be none — pending rows never match). */
  skipped: number;
  errors: string[];
};

export type NighthawkDebriefPassDeps = {
  fetchRows: typeof fetchNighthawkDebriefPendingOutcomes;
  pin: typeof pinNighthawkPlayDebrief;
};

/** Pin a debrief onto every graded-but-undebriefed row in the window. Never throws. */
export async function runNighthawkDebriefPass(
  opts: { lookbackDays?: number; limit?: number; nowMs: number },
  deps: Partial<NighthawkDebriefPassDeps> = {}
): Promise<NighthawkDebriefPassResult> {
  const result: NighthawkDebriefPassResult = {
    ok: true,
    scanned: 0,
    pinned: 0,
    already_pinned: 0,
    skipped: 0,
    errors: [],
  };
  const fetchRows = deps.fetchRows ?? fetchNighthawkDebriefPendingOutcomes;
  const pin = deps.pin ?? pinNighthawkPlayDebrief;

  let rows: NighthawkPlayOutcomeRow[];
  try {
    rows = await fetchRows(
      opts.lookbackDays ?? DEBRIEF_PASS_LOOKBACK_DAYS,
      opts.limit ?? DEBRIEF_PASS_MAX_ROWS
    );
  } catch (err) {
    result.ok = false;
    result.errors.push(`debrief queue fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  for (const row of rows) {
    result.scanned += 1;
    try {
      const debrief = debriefPlay(row);
      if (debrief == null) {
        result.skipped += 1;
        continue;
      }
      const res = await pin(row.id, {
        ...debrief,
        // Stamped here (not inside the pure builder) — the pin records when the pass
        // ran; the debrief itself is a pure function of the row.
        debriefed_at: new Date(opts.nowMs).toISOString(),
      });
      if (!res.matched) {
        result.skipped += 1;
      } else if (res.written) {
        result.pinned += 1;
      } else {
        result.already_pinned += 1;
      }
    } catch (err) {
      result.errors.push(
        `${row.ticker}@${row.edition_for}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

// ── Pass 2: counterfactual-grade the publish-gate rejections ────────────────────────

export const NH_REJECTION_COUNTERFACTUAL_VERSION = 1;
/** Bounded like the debrief pass, but tighter: each ungraded rejection costs one
 *  Polygon daily-bar call. */
export const CF_PASS_LOOKBACK_DAYS = 30;
export const CF_PASS_MAX_ROWS = 40;

export type NighthawkRejectionCounterfactual = {
  version: typeof NH_REJECTION_COUNTERFACTUAL_VERSION;
  /** "underlying_daily_bar" — level-touch on the underlying, the same basis the real
   *  grader uses. Null when ungradeable. Option premium is NEVER fabricated. */
  basis: "underlying_daily_bar" | null;
  /** resolveOutcome vocabulary, or "ungradeable" (with reason) when the play cannot be
   *  reconstructed — persisted either way so a row is never re-ground every run. */
  outcome: "target" | "stop" | "open" | "ambiguous" | "unfilled" | "ungradeable";
  hit_target: boolean | null;
  hit_stop: boolean | null;
  bar: { o: number; h: number; l: number; c: number } | null;
  /** Close vs published entry mid, direction-signed % (null when the band is corrupt —
   *  entryRangeMid's shared guard). */
  realized_return_pct: number | null;
  /** Strict: a graded 'target', or an 'open' that closed profitably. 'unfilled' /
   *  'stop' / 'ambiguous' / unknown are NOT wins — conservative against the
   *  counterfactual, mirroring skip-grading.ts's tie rule. */
  would_have_won: boolean;
  reason: string | null;
  graded_at: string;
};

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Structural read of the levels the rejection's audit row snapshotted at decision
 *  time (inputSnapshotForRejection's base fields, play-outcomes.ts). */
export function levelsFromRejectionSnapshot(inputSnapshot: unknown): {
  entry_range_low: number | null;
  entry_range_high: number | null;
  target: number | null;
  stop: number | null;
} {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const s = (inputSnapshot != null && typeof inputSnapshot === "object" ? inputSnapshot : {}) as Record<
    string,
    unknown
  >;
  return {
    entry_range_low: num(s.entry_range_low),
    entry_range_high: num(s.entry_range_high),
    target: num(s.target),
    stop: num(s.stop),
  };
}

/**
 * Grade ONE gate-blocked play counterfactually from its snapshot levels + the target
 * session's daily bar. Pure: bar in, verdict out; `nowMs` is a parameter. Uses the
 * EXACT production grader (resolveOutcome) so a blocked play and a published play can
 * never be scored under different physics.
 */
export function gradeRejectedPlay(input: {
  rejection: Pick<NighthawkPublishGateRejectionRow, "ticker" | "edition_for" | "direction" | "input_snapshot">;
  bar: { o: number; h: number; l: number; c: number };
  nowMs: number;
}): NighthawkRejectionCounterfactual {
  const gradedAt = new Date(input.nowMs).toISOString();
  const levels = levelsFromRejectionSnapshot(input.rejection.input_snapshot);
  if (levels.target == null && levels.stop == null) {
    return {
      version: NH_REJECTION_COUNTERFACTUAL_VERSION,
      basis: null,
      outcome: "ungradeable",
      hit_target: null,
      hit_stop: null,
      bar: null,
      realized_return_pct: null,
      would_have_won: false,
      reason: "no target or stop in the rejection snapshot — the plan cannot be reconstructed",
      graded_at: gradedAt,
    };
  }

  // A minimal outcome row for resolveOutcome — only the fields it reads are real.
  const verdict = resolveOutcome({
    id: 0,
    edition_for: input.rejection.edition_for,
    ticker: input.rejection.ticker,
    direction: input.rejection.direction,
    conviction: "",
    entry_range_low: levels.entry_range_low,
    entry_range_high: levels.entry_range_high,
    target: levels.target,
    stop: levels.stop,
    score: null,
    sector: null,
    next_day_open: input.bar.o,
    next_day_close: input.bar.c,
    session_high: input.bar.h,
    session_low: input.bar.l,
    hit_target: false,
    hit_stop: false,
    outcome: "pending",
    created_at: gradedAt,
  });

  const mid = entryRangeMid(levels.entry_range_low, levels.entry_range_high);
  const ret =
    mid != null && mid !== 0
      ? round2(((input.rejection.direction === "LONG" ? input.bar.c - mid : mid - input.bar.c) / mid) * 100)
      : null;
  const outcome = verdict.outcome === "pending" ? "ungradeable" : verdict.outcome;
  return {
    version: NH_REJECTION_COUNTERFACTUAL_VERSION,
    basis: outcome === "ungradeable" ? null : "underlying_daily_bar",
    outcome,
    hit_target: verdict.hit_target,
    hit_stop: verdict.hit_stop,
    bar: input.bar,
    realized_return_pct: ret,
    would_have_won: outcome === "target" || (outcome === "open" && ret != null && ret > 0),
    reason: outcome === "ungradeable" ? "grader returned pending on a complete bar (no close)" : null,
    graded_at: gradedAt,
  };
}

export type NighthawkRejectionCfResult = {
  ok: boolean;
  scanned: number;
  graded: number;
  ungradeable: number;
  /** No daily bar yet for the target session (future/holiday) — retried next run. */
  skipped_no_bar: number;
  errors: string[];
  note?: string;
};

export type NighthawkRejectionCfDeps = {
  fetchRejections: typeof fetchNighthawkPublishGateRejections;
  persist: typeof setNighthawkRejectionCounterfactual;
  fetchDailyBar: (
    ticker: string,
    from: string,
    to: string
  ) => Promise<Array<{ o: number; h: number; l: number; c: number }>>;
  polygonReady: () => boolean;
};

/** Counterfactually grade every not-yet-graded publish-gate rejection in the window
 *  and pin the verdict (first-write-wins). Bounded, idempotent, never throws. */
export async function runNighthawkRejectionCounterfactuals(
  opts: { lookbackDays?: number; limit?: number; nowMs: number },
  deps: Partial<NighthawkRejectionCfDeps> = {}
): Promise<NighthawkRejectionCfResult> {
  const result: NighthawkRejectionCfResult = {
    ok: true,
    scanned: 0,
    graded: 0,
    ungradeable: 0,
    skipped_no_bar: 0,
    errors: [],
  };
  const polygonReady = deps.polygonReady ?? polygonConfigured;
  if (!polygonReady()) {
    return { ...result, note: "Polygon not configured — counterfactual grading skipped" };
  }
  const fetchRejections = deps.fetchRejections ?? fetchNighthawkPublishGateRejections;
  const persist = deps.persist ?? setNighthawkRejectionCounterfactual;
  const fetchDailyBar =
    deps.fetchDailyBar ??
    ((ticker: string, from: string, to: string) => fetchStockDailyBars(ticker, from, to, "1"));

  let rejections: NighthawkPublishGateRejectionRow[];
  try {
    rejections = await fetchRejections(opts.lookbackDays ?? CF_PASS_LOOKBACK_DAYS, {
      ungradedOnly: true,
      limit: opts.limit ?? CF_PASS_MAX_ROWS,
    });
  } catch (err) {
    result.ok = false;
    result.errors.push(`rejection fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  for (const rejection of rejections) {
    result.scanned += 1;
    try {
      // The SAME bar path the real grader walks (resolvePendingNighthawkOutcomes):
      // one daily bar for the play's single target session.
      const bars = await fetchDailyBar(rejection.ticker, rejection.edition_for, rejection.edition_for);
      const bar = bars[0];
      if (!bar) {
        // Session bar not available yet (edition for a future/holiday date) — leave
        // ungraded; the next run retries for free.
        result.skipped_no_bar += 1;
        continue;
      }
      const cf = gradeRejectedPlay({
        rejection,
        bar: { o: bar.o, h: bar.h, l: bar.l, c: bar.c },
        nowMs: opts.nowMs,
      });
      await persist(rejection.id, cf as unknown as Record<string, unknown>);
      if (cf.outcome === "ungradeable") result.ungradeable += 1;
      else result.graded += 1;
    } catch (err) {
      result.errors.push(
        `${rejection.ticker}@${rejection.edition_for}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}
