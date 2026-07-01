import { test } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import { entryMid, realizedReturnPct, avgLoserReturn } from "./analytics";

// Regression: this file used to compute entry mid inline with no corruption
// guard, duplicating (and diverging from) track-record-page.ts's nhEntryMid(),
// and never clamped avg_loser_return_pct — so a corrupt DB row (or a
// stop-hit play that legitimately closed favorably) could show a member- or
// admin-facing "stop row +5.25%" instead of a loss. Both are now backed by
// the shared src/lib/nighthawk/entry-range.ts guard.

const row = (overrides: Partial<NighthawkPlayOutcomeRow>): NighthawkPlayOutcomeRow => ({
  id: 1,
  edition_for: "2026-06-30",
  ticker: "AAPL",
  direction: "LONG",
  conviction: "A",
  entry_range_low: 448,
  entry_range_high: 452,
  target: 460,
  stop: 440,
  score: 70,
  sector: "Tech",
  next_day_open: 450,
  next_day_close: 455,
  session_high: 456,
  session_low: 449,
  hit_target: false,
  hit_stop: false,
  outcome: "target",
  created_at: "2026-06-30T09:00:00Z",
  ...overrides,
});

test("entryMid rejects a corrupt entry range (stray low bound) with no fallback", () => {
  assert.equal(entryMid(row({ entry_range_low: 17, entry_range_high: 452 })), null);
});

test("realizedReturnPct is null (not a garbage number) when the entry range is corrupt", () => {
  assert.equal(realizedReturnPct(row({ entry_range_low: 17, entry_range_high: 452 })), null);
});

test("realizedReturnPct computes normally for a legitimate range", () => {
  // entry mid = 450, close = 459 -> +2%
  assert.equal(realizedReturnPct(row({ next_day_close: 459 })), 2);
});

test("avgLoserReturn clamps to <= 0 even when a stop row's realized return computes positive", () => {
  // A "stop" row that legitimately (or due to bad grading) closed above its
  // entry mid must never show as a positive average loss.
  const stopRow = row({ direction: "LONG", outcome: "stop", next_day_close: 473.6 }); // (473.6-450)/450 = +5.24%
  assert.ok((realizedReturnPct(stopRow) ?? 0) > 5);
  assert.equal(avgLoserReturn([stopRow]), 0);
});

test("avgLoserReturn passes through a genuine negative average unclamped", () => {
  const stopRow = row({ direction: "LONG", outcome: "stop", next_day_close: 441 }); // -2%
  assert.equal(avgLoserReturn([stopRow]), -2);
});
