// Pure-core table tests for the gate-calibration analyzer (PR-C). No providers, no
// DB, no clock — analyzeGateCalibration is deterministic over fixture rows, so every
// graduation boundary (n=9 vs 10, 14.9 vs 15.1 pts) is pinned exactly.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analyzeGateCalibration,
  calibrationScoreBand,
  gateVerdictOf,
  ENFORCE_MIN_BLOCK_N,
  ENFORCE_MIN_DELTA_PTS,
  type CalibrationPlayRow,
  type GradedSkipInput,
} from "./calibration";
import { LOW_N_THRESHOLD } from "./record";
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
});
