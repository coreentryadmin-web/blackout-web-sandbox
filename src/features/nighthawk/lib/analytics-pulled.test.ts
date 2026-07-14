import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";

// PR-N4: pulled plays (INVALIDATED pre-open, one-way latch) are graded COUNTERFACTUALLY
// — the grading path is unchanged and the outcome lands on the row — but they must NEVER
// count in the headline record, in either direction. The `pulled` flag on the row IS the
// methodology tag N2's versioned record segments on. Two surfaces share the rule:
//   - getNighthawkMetrics (Hawk Record strip / admin dashboard) — driven here through a
//     mocked @/lib/db (same spread-the-real-module idiom as
//     edition-builder-scoring-history.test.ts);
//   - isNighthawkOutcomeScoreable (public track-record page + signal accuracy +
//     /api/track-record/plays) — pure, asserted directly.

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
    // PR-N2: current-methodology by default — this suite pins the PULLED exclusion,
    // and only current-segment rows reach the headline math it asserts on.
    grade_methodology: "v2_fillability",
    legacy_grade: null,
    ...over,
  };
}

// analytics.ts statically imports fetchNighthawkOutcomeAnalytics/fetchNighthawkFunnelStats
// (plus the row type) from "@/lib/db" — mock.module fully replaces the module, so spread
// the real one and override only the two reads this suite drives.
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
const trackRecordMod = () => import("../../../lib/track-record-page");

test("getNighthawkMetrics: a pulled play's counterfactual grade never counts — either direction", async () => {
  const { getNighthawkMetrics } = await mod();

  // 2 honest wins + 1 honest stop, PLUS a pulled would-have-won and a pulled
  // would-have-stopped. Headline must read 2/3 (66.7%), not 3/5 or 2/5.
  state.rows = [
    row({ id: 1, ticker: "NVDA", outcome: "target" }),
    row({ id: 2, ticker: "MSFT", outcome: "target" }),
    row({ id: 3, ticker: "WFC", outcome: "stop", next_day_close: 94, session_low: 94, hit_target: false, hit_stop: true }),
    row({ id: 4, ticker: "AMD", outcome: "target", pulled: true, pulled_reason: "Pulled pre-open: gapped through the stop" }),
    row({ id: 5, ticker: "TSLA", outcome: "stop", pulled: true, pulled_reason: "Pulled pre-open: regime flip", next_day_close: 94, session_low: 94, hit_target: false, hit_stop: true }),
  ];
  state.pending = 0;

  const metrics = await getNighthawkMetrics(30);

  assert.equal(metrics.pulled_count, 2);
  assert.equal(metrics.total_resolved, 5, "pulled rows still exist in the resolved total (honest, not hidden)");
  // 2 wins / 3 scoreable — the pulled would-have-won must not pad this to 3/4,
  // and the pulled would-have-stopped must not sink it to 2/4.
  assert.ok(Math.abs(metrics.win_rate - 2 / 3) < 1e-9, `win_rate ${metrics.win_rate} != 2/3`);
  assert.ok(Math.abs(metrics.loss_rate - 1 / 3) < 1e-9);
  // Bucket cuts share the exclusion: AMD/TSLA appear in no conviction bucket n.
  const totalBucketN = metrics.by_conviction.reduce((s, b) => s + b.n, 0);
  assert.equal(totalBucketN, 3);
});

test("getNighthawkMetrics: DEGRADED plays (never latched) keep counting — only pulled is excluded", async () => {
  const { getNighthawkMetrics } = await mod();
  // A degraded play has a morning_verdict but pulled=false — fully scoreable.
  state.rows = [
    row({
      id: 1,
      ticker: "TSLA",
      outcome: "stop",
      next_day_close: 94,
      session_low: 94,
      hit_target: false,
      hit_stop: true,
      morning_verdict: { status: "DEGRADED", reason: "contrary anomaly" },
      pulled: false,
    }),
  ];
  state.pending = 0;

  const metrics = await getNighthawkMetrics(30);
  assert.equal(metrics.pulled_count, 0);
  assert.equal(metrics.loss_rate, 1, "the degraded play's real loss still counts — DEGRADED is advisory");
});

test("isNighthawkOutcomeScoreable: pulled excluded; degraded-but-not-pulled included (all headline surfaces share this)", async () => {
  const { isNighthawkOutcomeScoreable } = await trackRecordMod();
  assert.equal(isNighthawkOutcomeScoreable(row({ outcome: "target" })), true);
  assert.equal(isNighthawkOutcomeScoreable(row({ outcome: "target", pulled: true })), false);
  assert.equal(isNighthawkOutcomeScoreable(row({ outcome: "stop", pulled: true })), false);
  assert.equal(
    isNighthawkOutcomeScoreable(row({ outcome: "stop", morning_verdict: { status: "DEGRADED" }, pulled: false })),
    true
  );
  // Rows read back before the PR-N4 columns existed (pulled undefined) stay scoreable.
  assert.equal(isNighthawkOutcomeScoreable(row({ outcome: "target", pulled: undefined })), true);
});
