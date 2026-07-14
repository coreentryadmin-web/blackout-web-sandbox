// P-6 backfill selector (docs/audit/NIGHTHAWK-VS-SLAYER-0DTE.md §4 fix 1, §5 P-6).
// Before the polygonSpotTicker() fix, an index-root ledger row (SPXW/SPX/NDX/…) was
// graded by fetching daily bars under the RAW option root — Polygon returns HTTP 200
// with ZERO results for those symbols, so gradeZeroDteLedger stamped the row `graded`
// with close_price = NULL and a permanently-null direction grade (the empty-success
// path bypasses the retry catch). The mapping fix stops the bleed for NEW rows; this
// module defines which HISTORICAL rows carry that exact wound so the admin backfill
// (clear graded_at → let the existing lazy grader re-grade via the fixed mapping)
// touches nothing else.
//
// Pure predicate only — the actual UPDATE lives in db.ts (resetNullGradedZeroDteRows)
// with a WHERE clause that must stay semantically identical to this function; the
// unit tests exercise THIS function against fixture rows as the executable spec.

import { INDEX_OPTION_ROOTS } from "./board";

/** Structural subset of ZeroDteSetupLogRow the selector reads. */
export type RegradeCandidateRow = {
  ticker: string;
  session_date: string;
  graded_at: string | null;
  close_price: number | null;
};

const INDEX_ROOT_SET = new Set(INDEX_OPTION_ROOTS.map((t) => t.toUpperCase()));

/** Is this ticker one of the index option roots the polygonSpotTicker mapping fixes? */
export function isIndexRootTicker(ticker: string): boolean {
  return INDEX_ROOT_SET.has(ticker.toUpperCase());
}

/**
 * The exact null-grade signature of the index-root bug, per the actual grading code
 * (scan.ts gradeZeroDteLedger → db.ts gradeZeroDteSetupRow):
 *  - `graded_at IS NOT NULL` — the grader stamped it "done" (an ungraded row needs
 *    no backfill; the lazy grader will reach it on its own),
 *  - `close_price IS NULL` — the stamp landed with no close, which for a FINISHED
 *    session can only mean the bar fetch came back empty (the raw-root bug). A row
 *    graded with a real close but null direction_hit (underlying_at_flag missing)
 *    is a DIFFERENT, unfixable-by-remapping wound and is deliberately excluded,
 *  - index-root ticker — the only class the mapping fix can actually re-grade,
 *  - `session_date < beforeDate` — never touch the live session (it isn't graded
 *    during RTH anyway; this makes the invariant explicit).
 */
export function needsIndexRootRegrade(row: RegradeCandidateRow, beforeDate: string): boolean {
  return (
    row.graded_at != null &&
    row.close_price == null &&
    isIndexRootTicker(row.ticker) &&
    row.session_date < beforeDate
  );
}
