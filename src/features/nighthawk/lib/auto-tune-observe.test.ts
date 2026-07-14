// PR-N11 — SHADOW auto-tune (observation-only) tests. The whole point of this suite is the
// SAFETY RAILS: every proposal is `applied: false`, values are clamped to hard bounds, and a
// proposal is only minted when the evidence clears the bar (n ≥ EVIDENCE_MIN_N, not low_n, and
// a real effect size). Below the bar the param appears observe-only (proposed_value: null).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTuningObservations,
  proposeForParam,
  TUNABLE_PARAMS,
  EVIDENCE_MIN_N,
  type TunableParam,
} from "./auto-tune-observe";
import { GATE_BAND_MAX_DISTANCE_PCT, GATE_TARGET_MAX_ATR_MULTIPLE } from "./publish-gates";
import type {
  NighthawkDebriefReport,
  GateMirrorLine,
  GateBlockedValueLine,
} from "./debrief-aggregate";

// ── Fixture builders ──────────────────────────────────────────────────────────────────

function mirrorLine(
  gate: "band_detached" | "target_unreachable",
  delta: number | null,
  over: Partial<GateMirrorLine> = {}
): GateMirrorLine {
  return {
    gate,
    would_block: { n: 6, wins: 1, losses: 5, win_rate_pct: 17, low_n: false },
    would_pass: { n: 6, wins: 5, losses: 1, win_rate_pct: 83, low_n: false },
    delta_win_rate_pts: delta,
    no_geometry_n: 0,
    ...over,
  };
}

function blockedLine(gate: string, rate: number | null, gradedN = 6): GateBlockedValueLine {
  return {
    gate,
    blocked_n: gradedN,
    graded_n: gradedN,
    ungraded_n: 0,
    would_have_won: rate != null ? Math.round((gradedN * rate) / 100) : 0,
    would_have_won_rate_pct: rate,
    unfilled_n: 0,
    low_n: gradedN < EVIDENCE_MIN_N,
  };
}

function report(mirror: GateMirrorLine[], blocked: GateBlockedValueLine[]): NighthawkDebriefReport {
  return {
    methodology: "test",
    window: { since: "2026-06-01", through: "2026-07-14", days: 45 },
    summary: { graded: 0, debriefed: 0, sessions: 0, failure_modes: [], legacy_excluded: 0, unpinned: 0, low_n: true },
    by_conviction: [],
    by_tier: [],
    gate_validation: { blocked_value: blocked, published_mirror: mirror },
    improvement_queue: [],
    available: true,
  };
}

const BAND = TUNABLE_PARAMS.find((p) => p.id === "band_detached_max_distance_pct")!;
const TARGET = TUNABLE_PARAMS.find((p) => p.id === "target_max_atr_multiple")!;

// ── Whitelist sanity ──────────────────────────────────────────────────────────────────

test("whitelist mirrors the live constants and nothing else is tunable", () => {
  assert.equal(TUNABLE_PARAMS.length, 2);
  assert.equal(BAND.current_value, GATE_BAND_MAX_DISTANCE_PCT);
  assert.equal(TARGET.current_value, GATE_TARGET_MAX_ATR_MULTIPLE);
});

// ── proposeForParam ───────────────────────────────────────────────────────────────────

test("mirror separates losers (delta ≥ bar, n ≥ min, not low_n) ⇒ tighten proposal, not applied", () => {
  const p = proposeForParam(BAND, mirrorLine("band_detached", 20), undefined);
  assert.equal(p.evidence_bar_cleared, true);
  assert.equal(p.direction, "tighten");
  assert.equal(p.proposed_value, BAND.current_value - BAND.step); // 2.5 - 0.5 = 2.0
  assert.equal(p.applied, false);
  assert.equal(p.evidence.low_n, false);
});

test("blocked value shows the gate removes winners ⇒ loosen proposal, not applied", () => {
  const p = proposeForParam(TARGET, undefined, blockedLine("target_unreachable", 50));
  assert.equal(p.evidence_bar_cleared, true);
  assert.equal(p.direction, "loosen");
  assert.equal(p.proposed_value, TARGET.current_value + TARGET.step); // 1.5 + 0.25 = 1.75
  assert.equal(p.applied, false);
});

test("below the evidence bar ⇒ observe-only (null proposal), never applied", () => {
  // delta under IMPROVEMENT_MIRROR_DELTA_PTS and no blocking-winner signal.
  const p = proposeForParam(BAND, mirrorLine("band_detached", 3), blockedLine("band_detached", 10));
  assert.equal(p.evidence_bar_cleared, false);
  assert.equal(p.proposed_value, null);
  assert.equal(p.direction, null);
  assert.equal(p.applied, false);
});

test("low_n evidence never clears the bar even with a big delta", () => {
  const lowNMirror = mirrorLine("band_detached", 30, {
    would_block: { n: 2, wins: 0, losses: 2, win_rate_pct: 0, low_n: true },
    would_pass: { n: 2, wins: 2, losses: 0, win_rate_pct: 100, low_n: true },
  });
  const p = proposeForParam(BAND, lowNMirror, undefined);
  assert.equal(p.evidence_bar_cleared, false);
  assert.equal(p.proposed_value, null);
});

test("proposed value is clamped to hard bounds", () => {
  const nearMin: TunableParam = { ...BAND, current_value: 1.2, min: 1.0, max: 6.0, step: 0.5 };
  const p = proposeForParam(nearMin, mirrorLine("band_detached", 25), undefined);
  // raw 1.2 - 0.5 = 0.7, clamped up to the 1.0 hard floor.
  assert.equal(p.proposed_value, 1.0);
  assert.match(p.rationale, /clamped to hard bound/);
});

test("mirror (tighten) takes precedence over a simultaneous blocked-winner (loosen) signal", () => {
  const p = proposeForParam(BAND, mirrorLine("band_detached", 20), blockedLine("band_detached", 60));
  assert.equal(p.direction, "tighten");
});

// ── buildTuningObservations ───────────────────────────────────────────────────────────

test("build: observation mode, applied:false everywhere, one proposal per whitelisted param", () => {
  const obs = buildTuningObservations(
    report(
      [mirrorLine("band_detached", 20), mirrorLine("target_unreachable", 2)],
      [blockedLine("target_unreachable", 50)]
    )
  );
  assert.equal(obs.mode, "observation");
  assert.equal(obs.applied, false);
  assert.equal(obs.proposals.length, TUNABLE_PARAMS.length);
  for (const p of obs.proposals) assert.equal(p.applied, false);

  const band = obs.proposals.find((p) => p.param === "band_detached_max_distance_pct")!;
  const target = obs.proposals.find((p) => p.param === "target_max_atr_multiple")!;
  assert.equal(band.direction, "tighten"); // from its mirror line
  assert.equal(target.direction, "loosen"); // from its blocked-value line
});

test("build: empty evidence ⇒ every proposal observe-only, still all applied:false", () => {
  const obs = buildTuningObservations(report([], []));
  assert.equal(obs.proposals.length, TUNABLE_PARAMS.length);
  for (const p of obs.proposals) {
    assert.equal(p.evidence_bar_cleared, false);
    assert.equal(p.proposed_value, null);
    assert.equal(p.applied, false);
  }
});
