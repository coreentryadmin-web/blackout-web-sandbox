import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import {
  GRADE_METHODOLOGY_CURRENT,
  GRADE_METHODOLOGY_LEGACY,
} from "./grade-methodology";

// PR-N2 record honesty: the headline record must be computed from CURRENT-methodology
// rows only — rows graded under the superseded level-touch rules (the phantom gap-away
// "wins") are reported as their own labeled segment and can NEVER aggregate into the
// headline win rate. Measured motivation (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md
// §2.1): the blend advertised 42.9% WR while the same history under current rules reads
// 11.1% — open-beyond-band plays graded 6T/1S (+5.11%) vs fillable plays 0T/4S (−1.39%).
//
// Same spread-the-real-db-module mock idiom as analytics-pulled.test.ts.

const state = {
  rows: [] as NighthawkPlayOutcomeRow[],
  pending: 0,
};

function row(over: Partial<NighthawkPlayOutcomeRow>): NighthawkPlayOutcomeRow {
  return {
    id: 1,
    edition_for: "2026-07-07",
    ticker: "AMD",
    direction: "LONG",
    conviction: "A",
    entry_range_low: 100,
    entry_range_high: 102,
    target: 110,
    stop: 95,
    score: 70,
    sector: "Technology",
    next_day_open: 101,
    next_day_close: 111,
    session_high: 112,
    session_low: 100.5,
    hit_target: true,
    hit_stop: false,
    outcome: "target",
    created_at: "2026-07-07T00:00:00.000Z",
    pulled: false,
    pulled_reason: null,
    publish_context: null,
    morning_verdict: null,
    grade_methodology: GRADE_METHODOLOGY_CURRENT,
    legacy_grade: null,
    ...over,
  };
}

const stopRow = (over: Partial<NighthawkPlayOutcomeRow>) =>
  row({ outcome: "stop", next_day_close: 94, session_low: 94, hit_target: false, hit_stop: true, ...over });

before(async () => {
  const realDb = await import("../../../lib/db");
  mock.module("../../../lib/db", {
    namedExports: {
      ...realDb,
      fetchNighthawkOutcomeAnalytics: async () => ({ rows: state.rows, pending_count: state.pending }),
      fetchNighthawkFunnelStats: async () => ({ published_count: 0, rejected_by_reason: [] }),
    },
  });
});

const mod = () => import("./analytics");

test("blend impossible: legacy phantom wins can NEVER move the headline win rate", async () => {
  const { getNighthawkMetrics } = await mod();

  // Current segment: 1 target / 5 stop → 1/6. Legacy segment: 6 phantom targets + 1 stop
  // (the exact pre-regrade app-graded shape that produced 42.9%).
  const current = [
    row({ id: 1, ticker: "AMD", outcome: "target" }),
    stopRow({ id: 2, ticker: "WFC" }),
    stopRow({ id: 3, ticker: "BAC" }),
    stopRow({ id: 4, ticker: "TSLA" }),
    stopRow({ id: 5, ticker: "AMZN" }),
    stopRow({ id: 6, ticker: "PG" }),
  ];
  const legacy = [
    row({ id: 11, ticker: "OKTA", grade_methodology: GRADE_METHODOLOGY_LEGACY }),
    row({ id: 12, ticker: "HIMS", grade_methodology: GRADE_METHODOLOGY_LEGACY }),
    row({ id: 13, ticker: "MRK", grade_methodology: GRADE_METHODOLOGY_LEGACY }),
    row({ id: 14, ticker: "ANET", grade_methodology: GRADE_METHODOLOGY_LEGACY }),
    row({ id: 15, ticker: "ORCL", grade_methodology: GRADE_METHODOLOGY_LEGACY }),
    row({ id: 16, ticker: "AMD2", grade_methodology: GRADE_METHODOLOGY_LEGACY }),
    stopRow({ id: 17, ticker: "MU", grade_methodology: GRADE_METHODOLOGY_LEGACY }),
  ];
  state.rows = [...current, ...legacy];
  state.pending = 0;

  const metrics = await getNighthawkMetrics(30);

  // Headline = current segment only: 1/6, not (1+6)/13 = 53.8% or any other blend.
  assert.ok(Math.abs(metrics.win_rate - 1 / 6) < 1e-9, `win_rate ${metrics.win_rate} != 1/6`);
  assert.equal(metrics.methodology, GRADE_METHODOLOGY_CURRENT);
  assert.equal(metrics.total_resolved, 13, "total_resolved stays the honest raw row count");

  // The segments are each internally consistent and never sum into the headline.
  assert.equal(metrics.segments.current.scoreable, 6);
  assert.equal(metrics.segments.current.wins, 1);
  assert.ok(Math.abs((metrics.segments.current.win_rate ?? 0) - 1 / 6) < 1e-9);
  assert.equal(metrics.segments.legacy.resolved, 7);
  assert.equal(metrics.segments.legacy.wins, 6);
  assert.equal(metrics.segments.legacy.methodology, GRADE_METHODOLOGY_LEGACY);
  assert.notEqual(metrics.segments.legacy.label, metrics.segments.current.label);

  // THE anti-blend assertion: flipping every legacy row to a win changes nothing
  // about the headline. If legacy and current ever aggregate, this fails.
  state.rows = [...current, ...legacy.map((r) => ({ ...r, outcome: "target" as const, hit_target: true, hit_stop: false }))];
  const flipped = await getNighthawkMetrics(30);
  assert.equal(flipped.win_rate, metrics.win_rate, "legacy grades must be inert to the headline");
  assert.equal(flipped.avg_return_pct, metrics.avg_return_pct);

  // Cuts are current-segment only too: 13 rows total but bucket ns sum to 6.
  const bucketN = flipped.by_conviction.reduce((s, b) => s + b.n, 0);
  assert.equal(bucketN, 6, "conviction cuts must never include legacy rows");
});

test("NULL/unknown methodology tags quarantine to the legacy segment, never the headline", async () => {
  const { getNighthawkMetrics, partitionByMethodology } = await mod();

  state.rows = [
    row({ id: 1, outcome: "target" }), // current
    row({ id: 2, ticker: "XYZ", grade_methodology: null }), // unstamped → legacy
    row({ id: 3, ticker: "ABC", grade_methodology: "v9_who_knows" }), // unknown → legacy
  ];
  state.pending = 0;

  const metrics = await getNighthawkMetrics(30);
  assert.equal(metrics.segments.current.resolved, 1);
  assert.equal(metrics.segments.legacy.resolved, 2);
  assert.equal(metrics.win_rate, 1, "only the stamped-current row counts");

  const { current, legacy } = partitionByMethodology(state.rows);
  assert.deepEqual(current.map((r) => r.id), [1]);
  assert.deepEqual(legacy.map((r) => r.id), [2, 3]);
});

test("unfilled stays out of the WR denominator but is surfaced — top-level and per-segment", async () => {
  const { getNighthawkMetrics } = await mod();

  state.rows = [
    row({ id: 1, outcome: "target" }),
    stopRow({ id: 2, ticker: "WFC" }),
    row({ id: 3, ticker: "OKTA", outcome: "unfilled", hit_target: false }),
    row({ id: 4, ticker: "HIMS", outcome: "unfilled", hit_target: false }),
    // Legacy unfilled (post-partial-regrade shape) — counts in the LEGACY segment's
    // unfilled, not the headline count that explains the current denominator.
    row({ id: 5, ticker: "MRK", outcome: "unfilled", hit_target: false, grade_methodology: GRADE_METHODOLOGY_LEGACY }),
  ];
  state.pending = 0;

  const metrics = await getNighthawkMetrics(30);
  assert.equal(metrics.win_rate, 0.5, "1 win / 2 scoreable — unfilled never in the denominator");
  assert.equal(metrics.unfilled_count, 2, "headline unfilled count = current segment's");
  assert.equal(metrics.segments.current.unfilled, 2);
  assert.equal(metrics.segments.legacy.unfilled, 1);
});

test("LOW-N discipline: every cut and segment below the shared threshold is flagged", async () => {
  const { getNighthawkMetrics } = await mod();
  const { LOW_N_THRESHOLD } = await import("../../../lib/zerodte/record");
  assert.equal(LOW_N_THRESHOLD, 5, "the shared platform threshold this suite pins against");

  // 4 scoreable current rows — below the n=5 threshold everywhere.
  state.rows = [
    row({ id: 1, outcome: "target" }),
    stopRow({ id: 2, ticker: "WFC" }),
    stopRow({ id: 3, ticker: "BAC" }),
    row({ id: 4, ticker: "MSFT", outcome: "open", hit_target: false }),
  ];
  state.pending = 0;

  const metrics = await getNighthawkMetrics(30);
  assert.equal(metrics.segments.current.low_n, true, "4 scoreable < 5 must be badged");
  for (const cut of metrics.by_conviction) {
    assert.equal(cut.low_n, cut.n < LOW_N_THRESHOLD, `by_conviction ${cut.conviction}`);
  }
  for (const cut of metrics.by_direction) {
    assert.equal(cut.low_n, cut.n < LOW_N_THRESHOLD, `by_direction ${cut.direction}`);
  }
  for (const cut of metrics.by_score_bucket) {
    assert.equal(cut.low_n, cut.n < LOW_N_THRESHOLD, `by_score_bucket ${cut.bucket}`);
  }
  for (const cut of metrics.by_sector) {
    assert.equal(cut.low_n, cut.n < LOW_N_THRESHOLD, `by_sector ${cut.sector}`);
  }
  for (const cut of metrics.by_edition) {
    assert.equal(cut.low_n, cut.n < LOW_N_THRESHOLD, `by_edition ${cut.edition_for}`);
  }
});

test("a segment with nothing scoreable reports win_rate null — never a fake 0% or 100%", async () => {
  const { buildRecordSegment } = await mod();

  const emptySeg = buildRecordSegment(GRADE_METHODOLOGY_LEGACY, []);
  assert.equal(emptySeg.win_rate, null);
  assert.equal(emptySeg.avg_return_pct, null);
  assert.equal(emptySeg.low_n, true);

  // All-unfilled segment (the honest post-regrade legacy end-state shape): resolved > 0
  // but nothing scoreable — still null, with the unfilled count carrying the story.
  const allUnfilled = buildRecordSegment(GRADE_METHODOLOGY_CURRENT, [
    row({ id: 1, outcome: "unfilled", hit_target: false }),
    row({ id: 2, outcome: "unfilled", hit_target: false }),
  ]);
  assert.equal(allUnfilled.resolved, 2);
  assert.equal(allUnfilled.scoreable, 0);
  assert.equal(allUnfilled.win_rate, null);
  assert.equal(allUnfilled.unfilled, 2);
});
