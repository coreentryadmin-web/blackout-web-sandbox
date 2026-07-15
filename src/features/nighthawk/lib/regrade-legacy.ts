// PR-N2 honest re-grade (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §2.1/§2.2 N-2).
//
// The 14 rows resolved before the fillability rule carry "level touch" grades: 6 of
// their "target" wins came from plays whose published entry band sat BELOW the open —
// the session gapped away and never traded back into the band, so no member could have
// filled the entry (open-beyond-band: 6T/1S, +5.11% avg; genuinely fillable: 0T/4S,
// −1.39%). Under the product's own CURRENT resolveOutcome those rows grade 'unfilled'.
// Until they are re-graded, the record silently blends two rule sets.
//
// This module re-runs the CURRENT resolveOutcome over each legacy-methodology row using
// the bar data ALREADY PERSISTED on the row (next_day_open/close/session_high/low) —
// no Polygon call, no new inputs, so the re-grade is deterministic and auditable: same
// persisted facts in, current-rules verdict out. The old grade is preserved verbatim in
// `legacy_grade` (COALESCE first-write-wins in regradeLegacyNighthawkOutcome — history
// is quarantined, never destroyed) and the row is stamped with the current methodology
// tag, after which it can never match this selector again (idempotence in SQL, mirrored
// by the fetch selector).
//
// Same shape as the PR-N1 stuck-row repair (regrade-stuck.ts): pure selector as the
// executable spec, injected I/O seams so the unit tests are hermetic, bounded, dry-run,
// invoked only through the audited admin route (mode:"legacy_methodology").

import {
  fetchLegacyGradedNighthawkOutcomes,
  regradeLegacyNighthawkOutcome,
  type NighthawkPlayOutcomeRow,
} from "@/lib/db";
import { resolveOutcome } from "./play-outcomes";
import { GRADE_METHODOLOGY_CURRENT, isCurrentGradeMethodology } from "./grade-methodology";

export const DEFAULT_SEARCH_WINDOW_DAYS = 90;
export const MAX_SEARCH_WINDOW_DAYS = 365;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** The regrade-eligibility rule: resolved AND not already graded under current rules.
 *  Exactly the analytics segmentation predicate inverted onto resolved rows — the set
 *  this repair drains IS the set the record quarantines as "legacy". */
export function isLegacyGradedNighthawkOutcome(
  row: Pick<NighthawkPlayOutcomeRow, "outcome" | "grade_methodology">
): boolean {
  if (row.outcome === "pending") return false;
  return !isCurrentGradeMethodology(row.grade_methodology);
}

/** I/O seams, injectable so the unit tests run without Postgres. */
export type RegradeLegacyDeps = {
  /** Legacy-methodology resolved rows in the window — prod: fetchLegacyGradedNighthawkOutcomes. */
  fetchLegacy: (windowDays: number) => Promise<NighthawkPlayOutcomeRow[]>;
  /** Persist a current-rules verdict, preserving the old grade — prod:
   *  regradeLegacyNighthawkOutcome (guarded to non-current rows; returns promoted?). */
  persist: (
    id: number,
    verdict: { hit_target: boolean; hit_stop: boolean; outcome: "target" | "stop" | "open" | "ambiguous" | "unfilled" }
  ) => Promise<boolean>;
};

export type RegradeLegacyOptions = {
  dryRun?: boolean;
  limit?: number;
  searchWindowDays?: number;
};

export type LegacyRegradedRowSummary = {
  id: number;
  ticker: string;
  edition_for: string;
  /** The superseded grade this run replaced (or WOULD replace, on dry-run). */
  previous_outcome: NighthawkPlayOutcomeRow["outcome"];
  /** The current-rules verdict. */
  outcome: NighthawkPlayOutcomeRow["outcome"];
  hit_target: boolean;
  hit_stop: boolean;
  /** True when the two rule sets disagree — the phantom-win signature when
   *  previous_outcome='target' and outcome='unfilled'. */
  changed: boolean;
};

export type RegradeLegacyResult = {
  dry_run: boolean;
  /** The methodology tag every promoted row carries after this run. */
  methodology: string;
  /** Legacy rows the selector matched (before the limit bound). */
  matched: number;
  /** Rows actually promoted this run (always 0 on dry-run). */
  regraded: number;
  /** Rows whose persisted bars can't support a current-rules verdict (close missing —
   *  resolveOutcome would return 'pending'). Left untouched; they stay quarantined in
   *  the legacy segment rather than gaining a fabricated current grade. */
  skipped_unresolvable: number;
  errors: string[];
  rows: LegacyRegradedRowSummary[];
};

function defaultDeps(): RegradeLegacyDeps {
  return {
    fetchLegacy: (windowDays) => fetchLegacyGradedNighthawkOutcomes(windowDays),
    persist: (id, verdict) => regradeLegacyNighthawkOutcome(id, verdict),
  };
}

/**
 * Re-grade every legacy-methodology resolved row under the CURRENT resolveOutcome,
 * from the row's own persisted bars. Bounded (limit, hard-capped), idempotent (a
 * promoted row is stamped current and never matches again — enforced in the SQL guard
 * AND the fetch selector), dry-runnable (resolves, persists nothing). Per-row failures
 * land in `errors`, never swallowed.
 */
export async function regradeLegacyNighthawkOutcomes(
  opts: RegradeLegacyOptions = {},
  deps: Partial<RegradeLegacyDeps> = {}
): Promise<RegradeLegacyResult> {
  const dryRun = opts.dryRun === true;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT)));
  const searchWindowDays = Math.min(
    MAX_SEARCH_WINDOW_DAYS,
    Math.max(1, Math.trunc(opts.searchWindowDays ?? DEFAULT_SEARCH_WINDOW_DAYS))
  );

  const io: RegradeLegacyDeps = { ...defaultDeps(), ...deps };

  const result: RegradeLegacyResult = {
    dry_run: dryRun,
    methodology: GRADE_METHODOLOGY_CURRENT,
    matched: 0,
    regraded: 0,
    skipped_unresolvable: 0,
    errors: [],
    rows: [],
  };

  const candidates = await io.fetchLegacy(searchWindowDays);
  // Re-assert eligibility in-process (defense in depth over the SQL selector) so an
  // injected/newer fetch can never feed an already-current row into a second regrade.
  const legacy = candidates.filter((row) => isLegacyGradedNighthawkOutcome(row));
  result.matched = legacy.length;

  for (const row of legacy.slice(0, limit)) {
    try {
      // Capture the superseded grade BEFORE persisting — persist implementations may
      // mutate the row object they were handed (the test harness does, mirroring the
      // DB row's post-UPDATE state), and the summary must report what was replaced.
      const previousOutcome = row.outcome;
      // Current rules over the SAME persisted inputs the original grade used — the
      // whole point: only the rule set changes, never the evidence.
      const verdict = resolveOutcome(row);
      const outcome = verdict.outcome;
      if (outcome === "pending") {
        // No close persisted — current rules cannot produce a verdict from this row's
        // facts. Leaving it legacy-tagged is honest (it IS ungraded-under-current-rules)
        // and it stays visible in the quarantined segment instead of vanishing.
        result.skipped_unresolvable += 1;
        continue;
      }

      if (!dryRun) {
        const promoted = await io.persist(row.id, {
          hit_target: verdict.hit_target,
          hit_stop: verdict.hit_stop,
          outcome,
        });
        // promoted=false means the SQL guard saw a current-tagged row (raced by another
        // run) — count nothing, the other run already owns the promotion.
        if (promoted) result.regraded += 1;
      }

      result.rows.push({
        id: row.id,
        ticker: row.ticker,
        edition_for: row.edition_for,
        previous_outcome: previousOutcome,
        outcome,
        hit_target: verdict.hit_target,
        hit_stop: verdict.hit_stop,
        changed: outcome !== previousOutcome,
      });
    } catch (err) {
      result.errors.push(
        `${row.ticker}@${row.edition_for}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}
