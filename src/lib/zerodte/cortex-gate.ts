// 0DTE Command × Night Hawk Cortex — the wire-in bridge (PR-B of
// docs/audit/NIGHTHAWK-CORTEX-DESIGN.md §4; wiring spec §2: "the gate stack
// (G-1..G-7) runs first (cheap, fail-closed); Cortex runs on survivors; vetoes
// block; score modifies the commit floor").
//
// Decision table this module implements for a FRESH, gate-surviving find:
//   - any Cortex VETO            → BLOCKED, exactly like a hard-gate block
//                                  (rejection code `cortex_veto:<source>` + the
//                                  evidence detail sentence, surfaced as SKIP);
//   - no veto, score < 0         → BLOCKED with `cortex_net_negative` — the
//                                  design's "a G-3-passing setup with net-negative
//                                  Cortex evidence still doesn't print";
//   - no veto, score ≥ 0         → PASS (commit proceeds; the full evidence vector
//                                  is pinned on the ledger row via entry_context);
//   - no source produced ANY evidence (outage/total timeout) → ABSTAIN — commit
//                                  proceeds on the hard gates alone, recorded
//                                  honestly as {abstained: true, reason}.
//
// WHY ABSTAIN is a pass-through and not a fail-closed block (deliberate asymmetry
// with the gate stack's own "unreadable input blocks" rule): the hard gates are the
// SAFETY floor — they already fail closed on unreadable tape/ledger/governor state.
// The Cortex is a PRECISION layer stacked on top of that floor; it can only ever
// remove additional plays. If a Cortex-wide outage (every reader down) also halted
// commits, one flaky upstream would silently turn the whole 0DTE engine off — a
// worse failure mode than briefly trading on gates alone, and an invisible one.
// The abstain is therefore allowed through BUT recorded on the row
// (entry_context.cortex.abstained), so the calibration loop can measure exactly
// how often — and how expensively — the desk traded without its evidence layer.
//
// Like the gate stack itself, everything here except evaluateCortexForCommit is
// pure (unit-testable, replayable against the 7/13 fixtures); ./scan.ts assembles
// the async inputs and owns the sequencing.

import {
  composeCortexEvidence,
  fetchCortexInputs,
  type CortexConviction,
  type CortexDirection,
  type CortexInputs,
  type CortexVerdict,
  type EvidenceItem,
} from "@/lib/nighthawk/cortex";
import type { ZeroDteGateBlock } from "./gates";

/** What the Cortex layer decided about a gate-surviving find. */
export type ZeroDteCortexDecision = "PASS" | "VETO" | "NET_NEGATIVE" | "ABSTAIN";

/**
 * The full Cortex assessment carried on a fresh find (EnrichedZeroDteSetup.cortex).
 * ABSTAIN deliberately carries NO verdict object: an all-absent verdict has no
 * evidence worth persisting, and shipping an empty vector dressed as one would be
 * the exact "nulls dressed as neutrality" the design forbids.
 */
export type ZeroDteCortexAssessment =
  | { decision: "ABSTAIN"; abstained: true; reason: string }
  | { decision: "PASS" | "VETO" | "NET_NEGATIVE"; abstained: false; verdict: CortexVerdict };

/** Signed score rendering ("+1.85" / "-0.6" / "0") — matches compose.ts's narrative. */
function fmtSigned(v: number): string {
  return v > 0 ? `+${v}` : `${v}`;
}

/** "[source] detail" one-liner for an evidence item — the payload/summary rendering. */
function evidenceLine(e: EvidenceItem): string {
  return `[${e.source}] ${e.detail}`;
}

/** Top-N evidence items by DECAYED weight (what the score actually used), rendered
 *  as one-liners. Stable for ties: sort is on weight desc only, and compose.ts
 *  already emits items in deterministic source order. */
function topEvidenceLines(items: EvidenceItem[], n: number): string[] {
  return [...items]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n)
    .map(evidenceLine);
}

/**
 * Fold a composed CortexVerdict into the commit decision (pure — the decision
 * table in the module doc). ABSTAIN is detected from the verdict itself: zero
 * vetoes/supports/opposes means NO source answered (every one reported absent),
 * which is "the Cortex cannot see", not "the Cortex sees nothing wrong".
 */
export function assessCortexVerdict(verdict: CortexVerdict): ZeroDteCortexAssessment {
  if (verdict.vetoes.length === 0 && verdict.supports.length === 0 && verdict.opposes.length === 0) {
    return {
      decision: "ABSTAIN",
      abstained: true,
      reason:
        `no Cortex source produced evidence (${verdict.absent.length} absent) — ` +
        "commit proceeds on the hard gates alone.",
    };
  }
  if (verdict.vetoes.length > 0) return { decision: "VETO", abstained: false, verdict };
  // Net-negative evidence blocks even with gates green (design §2): score is the
  // bounded modifier on the commit decision, never a mutation of the setup's own
  // displayed score. Net-zero is NOT net-negative — evidence that exactly cancels
  // is a wash, and a wash never overrules gates that already said yes.
  if (verdict.score < 0) return { decision: "NET_NEGATIVE", abstained: false, verdict };
  return { decision: "PASS", abstained: false, verdict };
}

/**
 * The gate-stack bridge: render a blocking assessment as ZeroDteGateBlock rows so
 * a Cortex block flows through the EXACT same plumbing as a hard-gate block —
 * same SKIP card rendering, same zerodte_scan_rejections persistence (via
 * gateRejectionFor: blocks[0].code becomes gate_failed, every reason sentence is
 * concatenated). PASS and ABSTAIN produce no blocks (commit proceeds).
 */
export function cortexGateBlocks(assessment: ZeroDteCortexAssessment | null): ZeroDteGateBlock[] {
  if (assessment == null || assessment.abstained || assessment.decision === "PASS") return [];
  if (assessment.decision === "VETO") {
    // One block per veto (not one merged block): each veto is an independent hard
    // fact with its own source + detail sentence, and the SKIP card should show all
    // of them — same "ALL failing gates, not just the first" rule as gates.ts.
    return assessment.verdict.vetoes.map(
      (v): ZeroDteGateBlock => ({
        code: `cortex_veto:${v.source}`,
        reason: `Cortex veto [${v.source}]: ${v.detail}`,
        threshold: null,
        unlock_et: null,
      })
    );
  }
  // NET_NEGATIVE — one block; the threshold is the 0 floor the score was judged
  // against, and the reason carries the top opposing evidence so the SKIP card
  // argues the block instead of just asserting it.
  const opposes = topEvidenceLines(assessment.verdict.opposes, 3);
  return [
    {
      code: "cortex_net_negative",
      reason:
        `Cortex evidence nets ${fmtSigned(assessment.verdict.score)} against this ` +
        `${assessment.verdict.direction} — a gate-passing setup with net-negative evidence ` +
        `still doesn't print. Opposing: ${opposes.join(" ")}`,
      threshold: 0,
      unlock_et: null,
    },
  ];
}

/** Compact verdict summary for board/Largo payloads: enough for a member-facing
 *  card (score, conviction, veto list, top-3 supports/opposes one-liners) without
 *  shipping the full evidence vector on every poll. */
export type ZeroDteCortexSummary =
  | { abstained: true; reason: string }
  | {
      abstained: false;
      decision: "PASS" | "VETO" | "NET_NEGATIVE";
      score: number;
      conviction: CortexConviction;
      /** Every veto as a "[source] detail" line (empty when clear). */
      vetoes: string[];
      /** Top-3 supporting/opposing one-liners by decayed weight. */
      top_supports: string[];
      top_opposes: string[];
    };

export function cortexSummaryFor(assessment: ZeroDteCortexAssessment | null): ZeroDteCortexSummary | null {
  if (assessment == null) return null;
  if (assessment.abstained) return { abstained: true, reason: assessment.reason };
  const v = assessment.verdict;
  return {
    abstained: false,
    decision: assessment.decision,
    score: v.score,
    conviction: v.conviction,
    vetoes: v.vetoes.map(evidenceLine),
    top_supports: topEvidenceLines(v.supports, 3),
    top_opposes: topEvidenceLines(v.opposes, 3),
  };
}

/**
 * The entry_context.cortex blob pinned on a COMMITTED ledger row — the FULL
 * evidence vector (design §3.1: "persist the entire evidence vector on every
 * commit"; the nightly calibration job of PR-C grades per-source hit rates from
 * exactly this). Blocked finds never reach this function's output path: they go
 * to zerodte_scan_rejections and never write a ledger row / entry_context at all
 * (persistZeroDteScan's blocked-find invariant).
 */
export type ZeroDteCortexEntryContext =
  | { abstained: true; reason: string }
  | {
      abstained: false;
      decision: "PASS" | "VETO" | "NET_NEGATIVE";
      as_of: string;
      score: number;
      conviction: CortexConviction;
      vetoes: EvidenceItem[];
      supports: EvidenceItem[];
      opposes: EvidenceItem[];
      absent: string[];
      narrative: string[];
    };

export function cortexEntryContextFor(
  assessment: ZeroDteCortexAssessment | null
): ZeroDteCortexEntryContext | null {
  if (assessment == null) return null; // Cortex never ran (refresh lane) — no blob, never a fake one
  if (assessment.abstained) return { abstained: true, reason: assessment.reason };
  const v = assessment.verdict;
  return {
    abstained: false,
    decision: assessment.decision,
    as_of: v.asOf,
    score: v.score,
    conviction: v.conviction,
    vetoes: v.vetoes,
    supports: v.supports,
    opposes: v.opposes,
    absent: v.absent,
    narrative: v.narrative,
  };
}

/** Injectable IO seams so the fail-soft contract below is testable without module
 *  mocks or a live platform (same idiom as fetch.ts's CortexFetchDeps). */
export type CortexCommitDeps = {
  fetchInputs?: (
    ticker: string,
    direction: CortexDirection,
    opts: { now: Date }
  ) => Promise<CortexInputs>;
  compose?: (inputs: CortexInputs) => CortexVerdict;
};

/**
 * The one IO entry point ./scan.ts calls per gate-surviving find: fetch the
 * (already time-budgeted) Cortex inputs, compose with the scan's own clock, fold
 * into the commit decision.
 *
 * FAIL-SOFT, HONESTLY: this function never throws. fetchCortexInputs already
 * never throws (worst case: every slice null → every source absent → ABSTAIN via
 * assessCortexVerdict), so the catch below only guards programmer error
 * (compose's invalid-clock TypeError and the like) — and even that degrades to an
 * ABSTAIN with the error class in the reason, never a stalled or halted scan. A
 * Cortex outage must not turn the whole 0DTE engine off; the hard gates are the
 * safety floor (see the module doc).
 */
export async function evaluateCortexForCommit(
  ticker: string,
  direction: CortexDirection,
  now: Date,
  deps: CortexCommitDeps = {}
): Promise<ZeroDteCortexAssessment> {
  try {
    const inputs = await (deps.fetchInputs ?? fetchCortexInputs)(ticker, direction, { now });
    const verdict = (deps.compose ?? composeCortexEvidence)(inputs);
    return assessCortexVerdict(verdict);
  } catch (err) {
    const cls = err instanceof Error ? err.name || err.constructor.name : typeof err;
    return {
      decision: "ABSTAIN",
      abstained: true,
      reason: `Cortex evaluation failed (${cls}) — commit proceeds on the hard gates alone.`,
    };
  }
}
