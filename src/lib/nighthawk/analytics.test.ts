import { test } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import { entryMid, realizedReturnPct, avgLoserReturn, buildNighthawkFunnel } from "./analytics";
import { REJECTION_TRIGGER_REASON } from "./play-outcomes";

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

// ── Task #145: funnel/rejection-rate stats (buildNighthawkFunnel) ────────────────────────

test("buildNighthawkFunnel: no candidates at all -> zeroed stats, no divide-by-zero", () => {
  const funnel = buildNighthawkFunnel(30, 0, []);
  assert.deepEqual(funnel, {
    window_days: 30,
    published_count: 0,
    rejected_count: 0,
    candidates_count: 0,
    rejection_rate: 0,
    by_stage: [],
  });
});

test("buildNighthawkFunnel: all candidates published, zero rejections -> rejection_rate 0", () => {
  const funnel = buildNighthawkFunnel(30, 12, []);
  assert.equal(funnel.published_count, 12);
  assert.equal(funnel.rejected_count, 0);
  assert.equal(funnel.candidates_count, 12);
  assert.equal(funnel.rejection_rate, 0);
  assert.deepEqual(funnel.by_stage, []);
});

test("buildNighthawkFunnel: mixed publish/reject computes candidates_count and rejection_rate correctly", () => {
  // 8 published, 2 rejected (geometry) -> 10 candidates considered, 20% rejection rate.
  const funnel = buildNighthawkFunnel(7, 8, [
    { trigger_reason: REJECTION_TRIGGER_REASON.geometry, n: 2 },
  ]);
  assert.equal(funnel.candidates_count, 10);
  assert.equal(funnel.rejected_count, 2);
  assert.equal(funnel.rejection_rate, 0.2);
  assert.equal(funnel.by_stage.length, 1);
  assert.equal(funnel.by_stage[0].stage, "geometry");
  assert.equal(funnel.by_stage[0].label, "Geometry");
  assert.equal(funnel.by_stage[0].trigger_reason, REJECTION_TRIGGER_REASON.geometry);
  assert.equal(funnel.by_stage[0].n, 2);
});

test("buildNighthawkFunnel: every rejection stage maps to a real, human-readable label", () => {
  // Guards the reverse-lookup in analytics.ts against a silent typo/mismatch versus
  // REJECTION_TRIGGER_REASON (play-outcomes.ts) — every stage must resolve to its own
  // label, never fall through to the "other" bucket.
  const rows = Object.entries(REJECTION_TRIGGER_REASON).map(([, trigger_reason]) => ({
    trigger_reason,
    n: 1,
  }));
  const funnel = buildNighthawkFunnel(30, 0, rows);
  const stages = funnel.by_stage.map((s) => s.stage).sort();
  assert.deepEqual(stages, Object.keys(REJECTION_TRIGGER_REASON).sort());
  for (const s of funnel.by_stage) {
    assert.notEqual(s.stage, "other");
    assert.ok(s.label.length > 0);
    assert.ok(!s.label.includes("_"), `label "${s.label}" should be humanized, not a raw slug`);
  }
});

test("buildNighthawkFunnel: sorts by_stage by count descending", () => {
  const funnel = buildNighthawkFunnel(30, 0, [
    { trigger_reason: REJECTION_TRIGGER_REASON.sector_concentration, n: 1 },
    { trigger_reason: REJECTION_TRIGGER_REASON.geometry, n: 5 },
    { trigger_reason: REJECTION_TRIGGER_REASON.premium_cap, n: 3 },
  ]);
  assert.deepEqual(
    funnel.by_stage.map((s) => s.stage),
    ["geometry", "premium_cap", "sector_concentration"]
  );
});

test("buildNighthawkFunnel: an unrecognized trigger_reason falls back to an 'other' bucket rather than throwing", () => {
  const funnel = buildNighthawkFunnel(30, 4, [{ trigger_reason: "some future reason not in the map", n: 1 }]);
  assert.equal(funnel.by_stage.length, 1);
  assert.equal(funnel.by_stage[0].stage, "other");
  assert.equal(funnel.by_stage[0].label, "Other");
  assert.equal(funnel.rejected_count, 1);
  assert.equal(funnel.candidates_count, 5);
});
