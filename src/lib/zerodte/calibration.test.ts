// Pure-core table tests for the gate-calibration analyzer (PR-C). No providers, no
// DB, no clock — analyzeGateCalibration is deterministic over fixture rows, so every
// graduation boundary (n=9 vs 10, 14.9 vs 15.1 pts) is pinned exactly.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analyzeGateCalibration,
  analyzeTierRecord,
  calibrationScoreBand,
  gateVerdictOf,
  ENFORCE_MIN_BLOCK_N,
  ENFORCE_MIN_DELTA_PTS,
  TIER_INVERSION_DELTA_PTS,
  TIER_INVERSION_MIN_N,
  type CalibrationPlayRow,
  type GradedSkipInput,
  type TierPlayRow,
} from "./calibration";
import { LOW_N_THRESHOLD } from "./record";
import { TIER_APLUS_UNLOCK, type ZeroDteTier } from "./tiers";
import type { SkipCounterfactual } from "./skip-grading";

const WINDOW = { since: "2026-06-13", through: "2026-07-13", days: 30 };

/** Fixture row builder. `win` sets a graded plan outcome; `g4`/`g6` set the pinned
 *  would_block verdict (null = G-4 tier "unknown" — VIX unavailable at commit). */
function play(opts: {
  win?: boolean;
  pnl?: number;
  ungraded?: boolean;
  score?: number; // entry_context.score (commit-time)
  scoreMax?: number;
  g4?: boolean | null;
  g6?: boolean;
  noCalibJson?: boolean;
}): CalibrationPlayRow {
  const win = opts.win ?? false;
  return {
    session_date: "2026-07-10",
    ticker: "SPY",
    direction: "long",
    score_max: opts.scoreMax ?? 70,
    plan_outcome: opts.ungraded ? null : win ? "doubled" : "stopped",
    plan_pnl_pct: opts.ungraded ? null : (opts.pnl ?? (win ? 100 : -50)),
    entry_context: opts.score != null ? { score: opts.score } : null,
    gate_calibration_json: opts.noCalibJson
      ? null
      : {
          score_at_commit: opts.score ?? opts.scoreMax ?? 70,
          g4_vix:
            opts.g4 === null
              ? { day_open_vix: null, tier: "unknown", would_block: false }
              : { day_open_vix: 18.2, tier: "elevated", would_block: opts.g4 ?? false },
          g6_conflict: { conflict: opts.g6 ?? false, would_block: opts.g6 ?? false },
        },
  };
}

function repeat(n: number, make: () => CalibrationPlayRow): CalibrationPlayRow[] {
  return Array.from({ length: n }, make);
}

test("gateVerdictOf: pinned verdicts read back; unknown-VIX and missing blobs are non-observations", () => {
  assert.equal(gateVerdictOf(play({ g4: true }), "g4_vix"), true);
  assert.equal(gateVerdictOf(play({ g4: false }), "g4_vix"), false);
  // G-4 tier "unknown" (day-open VIX unavailable) must NOT count as a pass vote.
  assert.equal(gateVerdictOf(play({ g4: null }), "g4_vix"), null);
  assert.equal(gateVerdictOf(play({ noCalibJson: true }), "g4_vix"), null);
  assert.equal(gateVerdictOf(play({ g6: true }), "g6_conflict"), true);
  // Malformed blob (would_block not boolean) → null, never a guess.
  const malformed = play({});
  (malformed.gate_calibration_json as Record<string, unknown>).g4_vix = { would_block: "yes" };
  assert.equal(gateVerdictOf(malformed, "g4_vix"), null);
});

test("bucket math: per-bucket n/wins/losses/win rate/avg pnl and the delta", () => {
  const rows = [
    // would_block: 1W/3L, pnls 100, -50, -50, -30 → avg -7.5
    play({ g4: true, win: true, pnl: 100 }),
    play({ g4: true, win: false, pnl: -50 }),
    play({ g4: true, win: false, pnl: -50 }),
    play({ g4: true, win: false, pnl: -30 }),
    // would_pass: 4W/2L
    ...repeat(4, () => play({ g4: false, win: true, pnl: 100 })),
    ...repeat(2, () => play({ g4: false, win: false, pnl: -50 })),
    // graded but no verdict → counted in no_verdict_n, never bucketed
    play({ noCalibJson: true, win: true }),
  ];
  const report = analyzeGateCalibration({ rows, window: WINDOW });
  const g4 = report.gates.find((g) => g.gate === "g4_vix")!;
  assert.deepEqual(g4.evidence.would_block, {
    label: "would_block",
    n: 4,
    wins: 1,
    losses: 3,
    win_rate_pct: 25,
    avg_pnl_pct: -7.5,
    low_n: true, // n=4 < 5
  });
  assert.deepEqual(g4.evidence.would_pass, {
    label: "would_pass",
    n: 6,
    wins: 4,
    losses: 2,
    win_rate_pct: 66.7,
    avg_pnl_pct: 50,
    low_n: false,
  });
  assert.equal(g4.evidence.no_verdict_n, 1);
  assert.equal(g4.evidence.delta_win_rate_pts, 41.7);
  assert.equal(report.graded_plays, 11);
});

test("LOW-N discipline: a low_n would_block bucket NEVER recommends, whatever the delta", () => {
  // 0% vs 100% — the most damning possible split, at n=4. Still no recommendation.
  const rows = [
    ...repeat(4, () => play({ g4: true, win: false })),
    ...repeat(10, () => play({ g4: false, win: true })),
  ];
  const g4 = analyzeGateCalibration({ rows, window: WINDOW }).gates[0]!;
  assert.equal(g4.evidence.would_block.low_n, true);
  assert.equal(g4.verdict, "insufficient_data");
});

test("LOW-N discipline: a low_n would_pass bucket blocks graduation too (no baseline)", () => {
  const rows = [
    ...repeat(12, () => play({ g4: true, win: false })), // block n=12 >= 10, 0% WR
    ...repeat(4, () => play({ g4: false, win: true })), // pass n=4 < 5
  ];
  const g4 = analyzeGateCalibration({ rows, window: WINDOW }).gates[0]!;
  assert.equal(g4.verdict, "insufficient_data");
  assert.match(g4.evidence.reason, /would_pass has n=4/);
});

test("graduation boundary: block n=9 is insufficient_data, n=10 enforces (same 100% vs 0% split)", () => {
  const passRows = repeat(10, () => play({ g4: false, win: true }));
  const at9 = analyzeGateCalibration({
    rows: [...repeat(9, () => play({ g4: true, win: false })), ...passRows],
    window: WINDOW,
  }).gates[0]!;
  assert.equal(at9.verdict, "insufficient_data");
  assert.equal(at9.evidence.would_block.n, ENFORCE_MIN_BLOCK_N - 1);

  const at10 = analyzeGateCalibration({
    rows: [...repeat(10, () => play({ g4: true, win: false })), ...passRows],
    window: WINDOW,
  }).gates[0]!;
  assert.equal(at10.verdict, "enforce");
});

test("graduation boundary: 14.9-pt delta keeps calibrating, 15.1 enforces, exactly 15.0 enforces (>=)", () => {
  // Large-n buckets so the delta is exactly constructible: would_pass 500/1000 = 50%.
  const passRows = [
    ...repeat(500, () => play({ g4: false, win: true })),
    ...repeat(500, () => play({ g4: false, win: false })),
  ];
  const blockRows = (wins: number) => [
    ...repeat(wins, () => play({ g4: true, win: true })),
    ...repeat(1000 - wins, () => play({ g4: true, win: false })),
  ];

  // 50% − 35.1% = 14.9 pts → under the bar.
  const under = analyzeGateCalibration({ rows: [...blockRows(351), ...passRows], window: WINDOW }).gates[0]!;
  assert.equal(under.verdict, "keep_calibrating");
  assert.equal(under.evidence.delta_win_rate_pts, 14.9);

  // 50% − 34.9% = 15.1 pts → clears.
  const over = analyzeGateCalibration({ rows: [...blockRows(349), ...passRows], window: WINDOW }).gates[0]!;
  assert.equal(over.verdict, "enforce");
  assert.equal(over.evidence.delta_win_rate_pts, 15.1);

  // "At least 15 points worse" is inclusive — a mathematically-exact 15.0 delta
  // enforces even when IEEE754 renders it as 14.999999999999996.
  const exact = analyzeGateCalibration({ rows: [...blockRows(350), ...passRows], window: WINDOW }).gates[0]!;
  assert.equal(exact.evidence.delta_win_rate_pts, ENFORCE_MIN_DELTA_PTS);
  assert.equal(exact.verdict, "enforce");
});

test("g6_conflict is bucketed off its own key, independently of g4", () => {
  const rows = [
    ...repeat(10, () => play({ g6: true, g4: false, win: false })), // g6 would-block, all losers
    ...repeat(10, () => play({ g6: false, g4: false, win: true })), // g6 would-pass, all winners
  ];
  const report = analyzeGateCalibration({ rows, window: WINDOW });
  const g6 = report.gates.find((g) => g.gate === "g6_conflict")!;
  assert.equal(g6.verdict, "enforce");
  assert.equal(g6.evidence.would_block.n, 10);
  // g4 saw the same 20 rows as all-pass — mixed record, no block bucket.
  const g4 = report.gates.find((g) => g.gate === "g4_vix")!;
  assert.equal(g4.evidence.would_block.n, 0);
  assert.equal(g4.verdict, "insufficient_data");
});

test("score bands: banded on the commit-time score when pinned, all five bands always present", () => {
  assert.equal(calibrationScoreBand(54.9), "score <55");
  assert.equal(calibrationScoreBand(55), "score 55-64");
  assert.equal(calibrationScoreBand(64.9), "score 55-64");
  assert.equal(calibrationScoreBand(65), "score 65-74");
  assert.equal(calibrationScoreBand(75), "score 75-84");
  assert.equal(calibrationScoreBand(85), "score 85+");

  const rows = [
    // entry_context.score 62 wins over the ratcheted score_max 91 — the band must
    // reflect the score the gates actually acted on (the C-2 lesson).
    play({ score: 62, scoreMax: 91, win: false }),
    play({ score: 70, win: true }),
    play({ score: 78, win: true }),
    play({ score: 88, win: false }),
    // No entry_context → falls back to score_max.
    play({ scoreMax: 50, win: false }),
  ];
  const report = analyzeGateCalibration({ rows, window: WINDOW });
  assert.deepEqual(
    report.score_bands.map((b) => [b.label, b.n, b.wins, b.low_n]),
    [
      ["score <55", 1, 0, true],
      ["score 55-64", 1, 0, true],
      ["score 65-74", 1, 1, true],
      ["score 75-84", 1, 1, true],
      ["score 85+", 1, 0, true],
    ]
  );
  // Evidence only: the report carries the current floor + a note, never a new floor.
  assert.equal(report.score_floor.current, 65);
  assert.match(report.score_floor.note, /never auto-moved/);
});

test("ungraded rows are counted but never bucketed", () => {
  const rows = [
    play({ ungraded: true, g4: true }),
    { ...play({ g4: true }), plan_outcome: "ungradeable", plan_pnl_pct: null },
    play({ g4: true, win: true }),
  ];
  const report = analyzeGateCalibration({ rows, window: WINDOW });
  assert.equal(report.total_rows, 3);
  assert.equal(report.graded_plays, 1);
  assert.equal(report.gates[0]!.evidence.would_block.n, 1);
});

function skip(gate: string, verdict: SkipCounterfactual["verdict"], basis: SkipCounterfactual["basis"]): GradedSkipInput {
  return {
    gate_failed: gate,
    counterfactual: {
      version: 1,
      basis,
      verdict,
      outcome: null,
      pnl_pct: null,
      entry: 1,
      exit: 1,
      move_pct: 0,
      reason: null,
      graded_at: "2026-07-13T20:00:00.000Z",
    } satisfies SkipCounterfactual,
  };
}

test("blocked-value lines: per-gate would-have-won rates with the same LOW-N discipline", () => {
  const skips: GradedSkipInput[] = [
    skip("tape_alignment", "would_have_won", "underlying"),
    skip("tape_alignment", "would_have_won", "underlying"),
    skip("tape_alignment", "would_have_won", "premium"),
    skip("tape_alignment", "would_have_lost", "underlying"),
    skip("tape_alignment", "would_have_lost", "underlying"),
    skip("tape_alignment", "ungradeable", null),
    skip("score_floor", "would_have_won", "underlying"),
    skip("score_floor", "would_have_lost", "underlying"),
    // Malformed blob — ignored, never a throw.
    { gate_failed: "opening_window", counterfactual: { junk: true } },
    { gate_failed: "opening_window", counterfactual: null },
  ];
  const report = analyzeGateCalibration({ rows: [], gradedSkips: skips, window: WINDOW });
  assert.deepEqual(report.blocked_value, [
    {
      gate_failed: "tape_alignment",
      n: 5,
      ungradeable: 1,
      would_have_won: 3,
      would_have_won_rate_pct: 60,
      by_basis: { premium: 1, underlying: 4 },
      low_n: false,
    },
    {
      gate_failed: "score_floor",
      n: 2,
      ungradeable: 0,
      would_have_won: 1,
      would_have_won_rate_pct: 50,
      by_basis: { premium: 0, underlying: 2 },
      low_n: true, // n=2 < LOW_N_THRESHOLD — no interpretation may rest on this line
    },
  ]);
  assert.equal(report.blocked_value[1]!.n < LOW_N_THRESHOLD, true);
});

test("empty window: available:false, machine-readable shape intact", () => {
  const report = analyzeGateCalibration({ rows: [], window: WINDOW });
  assert.equal(report.available, false);
  assert.equal(report.graded_plays, 0);
  assert.equal(report.gates.length, 2);
  assert.equal(report.gates[0]!.verdict, "insufficient_data");
  assert.equal(report.score_bands.length, 5);
  assert.deepEqual(report.blocked_value, []);
  // tier_record is additive but always present, with the stable all-tiers shape.
  assert.deepEqual(report.tier_record.tiers.map((t) => [t.tier, t.n]), [["A", 0], ["B", 0], ["C", 0]]);
  assert.equal(report.tier_record.untiered_n, 0);
  assert.equal(report.tier_record.tier_inversion, false);
  assert.equal(report.tier_record.aplus.unlocked, false);
});

// ── Merit-tier record analysis (PR-F) ──────────────────────────────────────────────

/** Canonical pinned entry_context blobs that tierFromEntryContext maps to each tier
 *  (verified by tiers.test.ts): A = prime score + calm VIX + clean Cortex; B = mid
 *  score + neutral VIX + thin Cortex; C = mid score + elevated VIX + washed Cortex. */
const TIER_CTX: Record<ZeroDteTier, Record<string, unknown>> = {
  A: {
    score: 78,
    vix_open: 16,
    committed_at_et: "2026-07-10 12:00 ET",
    cortex: { abstained: false, score: 1.5, vetoes: [], supports: [{}, {}] },
  },
  B: {
    score: 70,
    vix_open: 14,
    committed_at_et: "2026-07-10 12:00 ET",
    cortex: { abstained: false, score: 0.5, vetoes: [], supports: [{}] },
  },
  C: {
    score: 66,
    vix_open: 18,
    committed_at_et: "2026-07-10 12:00 ET",
    cortex: { abstained: false, score: 0, vetoes: [], supports: [] },
  },
};

function tierRow(tier: ZeroDteTier | null, win: boolean, pnl?: number): TierPlayRow {
  return {
    plan_outcome: win ? "doubled" : "stopped",
    plan_pnl_pct: pnl ?? (win ? 100 : -50),
    entry_context: tier == null ? null : TIER_CTX[tier],
  };
}

function tierRows(tier: ZeroDteTier | null, wins: number, losses: number): TierPlayRow[] {
  return [
    ...Array.from({ length: wins }, () => tierRow(tier, true)),
    ...Array.from({ length: losses }, () => tierRow(tier, false)),
  ];
}

test("analyzeTierRecord: per-tier buckets from retro-tiered entry_context; untiered rows counted, never dumped into C", () => {
  const rows: TierPlayRow[] = [
    ...tierRows("A", 2, 1),
    ...tierRows("B", 1, 3),
    ...tierRows("C", 0, 2),
    ...tierRows(null, 5, 0), // pre-C-2 rows: graded but no pinned evidence
    { plan_outcome: null, plan_pnl_pct: null, entry_context: TIER_CTX.A }, // ungraded — never bucketed
    { plan_outcome: "ungradeable", plan_pnl_pct: null, entry_context: TIER_CTX.B },
  ];
  const rec = analyzeTierRecord(rows);
  assert.deepEqual(
    rec.tiers.map((t) => [t.tier, t.n, t.wins, t.win_rate_pct, t.low_n]),
    [
      ["A", 3, 2, 66.7, true],
      ["B", 4, 1, 25, true],
      ["C", 2, 0, 0, true],
    ]
  );
  // The 5 winning pre-context rows do NOT inflate any bucket — C stays 0/2.
  assert.equal(rec.untiered_n, 5);
  assert.equal(rec.tier_inversion, false); // LOW-N everywhere → no inversion possible
});

test("tier inversion: fires when a lower tier beats a higher by >10 pts at n>=10 each", () => {
  assert.equal(TIER_INVERSION_DELTA_PTS, 10);
  assert.equal(TIER_INVERSION_MIN_N, 10);
  // A: 50% (n=100) vs B: 61% (n=100) — 11 pts, both big buckets → provably wrong weights.
  const rec = analyzeTierRecord([...tierRows("A", 50, 50), ...tierRows("B", 61, 39)]);
  assert.equal(rec.tier_inversion, true);
  assert.deepEqual(rec.inversions, [{ higher: "A", lower: "B", delta_pts: 11 }]);
});

test("tier inversion boundary: exactly 10.0 pts does NOT fire (one-flipped-play noise bound, float-dust safe)", () => {
  // A 5/10 = 50% vs B 6/10 = 60%: IEEE754 renders the delta 10.000000000000007 —
  // the epsilon must keep a mathematically-exact 10.0 from falsely firing.
  const atBoundary = analyzeTierRecord([...tierRows("A", 5, 5), ...tierRows("B", 6, 4)]);
  assert.equal(atBoundary.tier_inversion, false);
  assert.deepEqual(atBoundary.inversions, []);
  // 10.1 pts (n=1000 buckets) fires.
  const over = analyzeTierRecord([...tierRows("A", 500, 500), ...tierRows("B", 601, 399)]);
  assert.equal(over.tier_inversion, true);
  assert.equal(over.inversions[0]!.delta_pts, 10.1);
});

test("tier inversion LOW-N discipline: n=9 buckets never flag, whatever the split", () => {
  // 0% vs 100% — the most damning possible inversion, one play short of the bar.
  const rec = analyzeTierRecord([...tierRows("A", 0, 9), ...tierRows("C", 9, 0)]);
  assert.equal(rec.tier_inversion, false);
  assert.deepEqual(rec.inversions, []);
  // Non-adjacent pairs are checked too: at n=10 each the same split DOES flag A-vs-C.
  const atN = analyzeTierRecord([...tierRows("A", 0, 10), ...tierRows("C", 10, 0)]);
  assert.deepEqual(atN.inversions, [{ higher: "A", lower: "C", delta_pts: 100 }]);
});

test("A+ unlock: earned at exactly n=10 / 80% WR; withheld at n=9 or 79.9%", () => {
  // Exactly at the bar: 8W/2L (n=10, 80.0%) → unlocked.
  const earned = analyzeTierRecord(tierRows("A", 8, 2));
  assert.equal(earned.aplus.unlocked, true);
  assert.equal(earned.aplus.a_graded, TIER_APLUS_UNLOCK.minGraded);
  assert.equal(earned.aplus.a_win_rate_pct, TIER_APLUS_UNLOCK.minWinRatePct);
  assert.match(earned.aplus.note, /EARNED/);

  // n=9 at 88.9% — a BETTER rate, still locked: the sample is one play short.
  const lowN = analyzeTierRecord(tierRows("A", 8, 1));
  assert.equal(lowN.aplus.unlocked, false);
  assert.match(lowN.aplus.note, /never asserted/);

  // 79.9% at n=1000 — huge sample, hair under the bar: locked (no rounding mercy).
  const under = analyzeTierRecord(tierRows("A", 799, 201));
  assert.equal(under.aplus.unlocked, false);
  assert.equal(under.aplus.a_win_rate_pct, 79.9);

  // B-bucket excellence never unlocks A+ — the promotion is about the A bucket only.
  const wrongBucket = analyzeTierRecord(tierRows("B", 20, 0));
  assert.equal(wrongBucket.aplus.unlocked, false);
});

test("tier_record rides the full calibration report additively", () => {
  const rows: CalibrationPlayRow[] = [
    { ...play({ win: true }), entry_context: TIER_CTX.A },
    { ...play({ win: false }), entry_context: TIER_CTX.C },
    play({ win: true }), // play()'s default has no usable tier evidence beyond score
  ];
  const report = analyzeGateCalibration({ rows, window: WINDOW });
  assert.equal(report.tier_record.tiers.find((t) => t.tier === "A")!.n, 1);
  assert.equal(report.tier_record.tiers.find((t) => t.tier === "C")!.n, 1);
  // The bare play() row has entry_context:null → untiered, not C.
  assert.equal(report.tier_record.untiered_n, 1);
});
