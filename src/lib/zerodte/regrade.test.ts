import { test } from "node:test";
import assert from "node:assert/strict";

// regrade.ts is a pure leaf (its only import is board.ts's INDEX_OPTION_ROOTS,
// itself dependency-light) — no mocks needed. These tests are the executable spec
// for db.ts's resetNullGradedZeroDteRows WHERE clause: if the SQL and this
// predicate ever disagree, one of them is wrong.
import { isIndexRootTicker, needsIndexRootRegrade, type RegradeCandidateRow } from "./regrade";

const TODAY = "2026-07-14";

function candidate(overrides: Partial<RegradeCandidateRow>): RegradeCandidateRow {
  return {
    ticker: "SPXW",
    session_date: "2026-07-10",
    graded_at: "2026-07-11T00:10:00Z",
    close_price: null,
    ...overrides,
  };
}

test("isIndexRootTicker covers exactly the polygonSpotTicker map, case-insensitive", () => {
  for (const t of ["SPX", "SPXW", "NDX", "NDXP", "RUT", "RUTW", "XSP", "VIX"]) {
    assert.equal(isIndexRootTicker(t), true, t);
  }
  assert.equal(isIndexRootTicker("spxw"), true);
  // ETF wrappers are real equities — Polygon prices them directly; never backfilled.
  assert.equal(isIndexRootTicker("SPY"), false);
  assert.equal(isIndexRootTicker("QQQ"), false);
  assert.equal(isIndexRootTicker("NVDA"), false);
});

test("needsIndexRootRegrade: the exact null-grade signature of the index-root bug", () => {
  // The wound: stamped graded, no close, index root, finished session.
  assert.equal(needsIndexRootRegrade(candidate({}), TODAY), true);

  // Ungraded rows need no backfill — the lazy grader reaches them on its own.
  assert.equal(needsIndexRootRegrade(candidate({ graded_at: null }), TODAY), false);

  // A real close means the grade landed (even if direction_hit is null for a
  // different reason) — remapping can't improve it; excluded.
  assert.equal(needsIndexRootRegrade(candidate({ close_price: 7575.39 }), TODAY), false);

  // Equity/ETF rows never had the bug (raw ticker prices directly on Polygon).
  assert.equal(needsIndexRootRegrade(candidate({ ticker: "SPY" }), TODAY), false);

  // Never touch the live session.
  assert.equal(needsIndexRootRegrade(candidate({ session_date: TODAY }), TODAY), false);
  assert.equal(needsIndexRootRegrade(candidate({ session_date: "2026-07-15" }), TODAY), false);

  // Idempotence: once cleared (graded_at NULL) the row can never match again.
  const cleared = candidate({ graded_at: null });
  assert.equal(needsIndexRootRegrade(cleared, TODAY), false);
});
