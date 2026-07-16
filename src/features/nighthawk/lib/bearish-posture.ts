// PR-N9: Bearish-tape posture — when the evening tape is bearish, re-rank
// candidates to prefer SHORT direction so the book produces shorts (or an
// explicit "no aligned setups" skip) instead of silently going recap-only.
//
// The decision doc (N-8): "The machine can only say 'long' or say nothing."
// On 7/02, 7/13, 7/14 the funnel zeroed on a bearish tape — exactly when a
// short book would have been the play. The scorer CAN emit shorts (2/26), but
// nothing forces the question "should tonight's book be short or empty?"
//
// This module answers that question. Pure over its inputs so it's testable
// without market data.

import type { NightHawkRegimeContext, ScoredCandidate } from "./scorer";

export type BookPosture = "LONG" | "SHORT" | "NEUTRAL";

export type PostureResult = {
  posture: BookPosture;
  reasons: string[];
  /** Candidates re-ranked with SHORT-preferred ordering when posture is SHORT. */
  ranked: ScoredCandidate[];
  /** Count of candidates whose direction was flipped to SHORT. */
  flipped: number;
};

// A bearish tape needs ≥2 of these 3 signals to trigger SHORT posture.
// A single bearish signal is normal market noise; two independent axes
// confirming bearish = the tape is telling us something.
export const BEARISH_POSTURE_MIN_SIGNALS = 2;

export function detectBookPosture(regime: NightHawkRegimeContext | null | undefined): {
  posture: BookPosture;
  reasons: string[];
} {
  if (!regime) return { posture: "NEUTRAL", reasons: [] };

  const signals: string[] = [];

  if (regime.tide_bias === "BEARISH") {
    signals.push("tide put-dominated (>55% put premium)");
  }

  if (regime.advance_pct != null && regime.advance_pct < 35) {
    signals.push(`breadth collapse (${regime.advance_pct.toFixed(1)}% advancing)`);
  }

  const comp = regime.composite_regime?.toUpperCase();
  if (comp && (comp.includes("BEARISH") || comp.includes("NEGATIVE"))) {
    signals.push(`composite regime bearish (${regime.composite_regime})`);
  }

  if (signals.length >= BEARISH_POSTURE_MIN_SIGNALS) {
    return { posture: "SHORT", reasons: signals };
  }

  return { posture: "NEUTRAL", reasons: [] };
}

// SHORT posture bonus: candidates already pointing short get a ranking boost;
// candidates pointing long get a penalty. The magnitude is enough to re-order
// the list but not so large that a garbage short beats a strong long — the
// downstream gates (geometry, grounding, critic) still vet everything.
const SHORT_POSTURE_BONUS = 8;
const LONG_POSTURE_PENALTY = 6;

export function applyBearishPosture(
  ranked: ScoredCandidate[],
  regime: NightHawkRegimeContext | null | undefined,
): PostureResult {
  const { posture, reasons } = detectBookPosture(regime);

  if (posture !== "SHORT") {
    return { posture, reasons, ranked, flipped: 0 };
  }

  let flipped = 0;
  const adjusted = ranked.map((c) => {
    if (c.direction === "short") {
      return { ...c, score: c.score + SHORT_POSTURE_BONUS };
    }
    // Long candidate on a bearish tape: check if the flow was close enough
    // to flip. If the flow was marginally long (flow_score contribution was
    // thin), flip direction to short and boost. Otherwise penalize but keep
    // the candidate — the downstream gates decide if it survives.
    if (c.flow_score <= 10) {
      flipped += 1;
      return { ...c, direction: "short" as const, score: c.score + SHORT_POSTURE_BONUS - LONG_POSTURE_PENALTY };
    }
    return { ...c, score: Math.max(0, c.score - LONG_POSTURE_PENALTY) };
  });

  const reranked = [...adjusted].sort((a, b) => b.score - a.score);

  return { posture, reasons, ranked: reranked, flipped };
}

export const BEARISH_RECAP_REASON = "Bearish-tape posture: no aligned SHORT setups survived the funnel on a bearish evening.";
