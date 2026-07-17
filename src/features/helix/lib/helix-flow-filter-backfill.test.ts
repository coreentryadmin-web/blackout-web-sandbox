import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dteFilterMaxDte,
  isRestrictiveTapeFilter,
  shouldAutoBackfillTape,
  HELIX_FILTER_BACKFILL_TARGET,
} from "./helix-flow-filter-backfill";

const openFilters = {
  dteFilter: "all" as const,
  typeFilter: "ALL" as const,
  whalesOnly: false,
  indicesOnly: false,
  watchlistOnly: false,
  tickerFilter: "",
};

test("dteFilterMaxDte maps server scope for 0DTE and week", () => {
  assert.equal(dteFilterMaxDte("0dte"), 0);
  assert.equal(dteFilterMaxDte("week"), 7);
  assert.equal(dteFilterMaxDte("all"), undefined);
  assert.equal(dteFilterMaxDte("month+"), undefined);
});

test("isRestrictiveTapeFilter detects narrowed views", () => {
  assert.equal(isRestrictiveTapeFilter(openFilters), false);
  assert.equal(isRestrictiveTapeFilter({ ...openFilters, dteFilter: "0dte" }), true);
  assert.equal(isRestrictiveTapeFilter({ ...openFilters, typeFilter: "CALL" }), true);
  assert.equal(isRestrictiveTapeFilter({ ...openFilters, whalesOnly: true }), true);
});

test("shouldAutoBackfillTape loads when filtered count is below target", () => {
  assert.equal(
    shouldAutoBackfillTape({
      filters: { ...openFilters, dteFilter: "0dte" },
      filteredCount: 12,
      hasMorePages: true,
      loading: false,
      loadingOlder: false,
      replayMode: false,
      pagesLoaded: 0,
    }),
    true
  );
  assert.equal(
    shouldAutoBackfillTape({
      filters: { ...openFilters, dteFilter: "0dte" },
      filteredCount: HELIX_FILTER_BACKFILL_TARGET,
      hasMorePages: true,
      loading: false,
      loadingOlder: false,
      replayMode: false,
      pagesLoaded: 0,
    }),
    false
  );
  assert.equal(
    shouldAutoBackfillTape({
      filters: openFilters,
      filteredCount: 5,
      hasMorePages: true,
      loading: false,
      loadingOlder: false,
      replayMode: false,
      pagesLoaded: 0,
    }),
    false
  );
});
