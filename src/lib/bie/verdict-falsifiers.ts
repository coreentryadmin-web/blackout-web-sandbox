// BIE verdict FALSIFIERS — the deterministic derivation + the pure interpreter (task #83).
//
// A verdict is only rigorous if it is FALSIFIABLE. This module derives the specific machine-checkable
// conditions that would flip a verdict FROM THE SAME EVIDENCE the verdict rests on (the live flip /
// walls / max-pain / spot), and evaluates those conditions later against a fresh snapshot — so
// "does that verdict still hold?" is answered by re-running the pinned predicates, never re-fabricated.
//
// Two halves, both PURE (no IO, no LLM, no `server-only`), directly unit-testable:
//   - deriveFalsifiers(evidence, bias) → BieFalsifier[]  (serializable specs, never closures)
//   - evaluateFalsifier(spec, baseline, current) → FalsifierStatus  (the interpreter)
//
// The predicates are real falsifiers of THIS verdict: they are built from the levels the verdict cited
// and phrased against the SIDE the verdict took (a bullish/long-side read is invalidated by LOSING the
// flip; a bearish/short-side read by RECLAIMING it). Boilerplate is never emitted — a falsifier is
// only produced when the level it watches is actually live.

import type { BieBias, BieFalsifier, BieFalsifierMetric } from "@/lib/bie/answer-envelope";

/** The live evidence a verdict rests on — the same numbers verdict-core renders. */
export type FalsifierEvidence = {
  spot: number | null;
  flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  max_pain: number | null;
  /** Regime posture the verdict took, so falsifiers phrase against the correct side. */
  regime: "long" | "short" | "transition" | "unknown" | null;
};

/** A live snapshot of the watched metrics — the evaluation input (baseline = at verdict time). */
export type FalsifierSnapshot = {
  spot: number | null;
  flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  max_pain: number | null;
};

/** Result of evaluating one falsifier against a fresh snapshot. */
export type FalsifierStatus = {
  id: string;
  effect: "invalidate" | "weaken";
  /** true when the predicate's condition is met on the current snapshot. */
  triggered: boolean;
  /** "holding" when not triggered; else "invalidated"/"weakened" per effect. */
  status: "holding" | "invalidated" | "weakened" | "indeterminate";
  /** One-line explanation of what was compared (the live numbers), for the recall answer. */
  detail: string;
};

const fin = (n: number | null | undefined): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;

const fmt = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function metricValue(m: BieFalsifierMetric, snap: FalsifierSnapshot): number | null {
  return fin(snap[m]);
}

const METRIC_LABEL: Record<BieFalsifierMetric, string> = {
  spot: "spot",
  flip: "gamma flip",
  call_wall: "call wall",
  put_wall: "put wall",
  max_pain: "max pain",
};

/**
 * Derive the falsifiers for a verdict from its live evidence + the bias/side it took. Every falsifier
 * is grounded in a level that is actually live (no boilerplate). Priorities:
 *   - the GAMMA FLIP is the regime hinge → the primary INVALIDATOR, phrased against the side taken
 *     (a read that sits above the flip is invalidated by closing below it, and vice-versa);
 *   - the aligned WALL is the thesis's target/pin → WEAKENED if it migrates to the wrong side of spot
 *     (a call wall above spot that migrates below spot has stopped being resistance/target);
 *   - MAX PAIN pinning the range → WEAKENED if it migrates across the flip (the pin target left the
 *     regime it was supporting).
 */
export function deriveFalsifiers(ev: FalsifierEvidence, bias: BieBias): BieFalsifier[] {
  const out: BieFalsifier[] = [];
  const spot = fin(ev.spot);
  const flip = fin(ev.flip);
  const callWall = fin(ev.call_wall);
  const putWall = fin(ev.put_wall);
  const maxPain = fin(ev.max_pain);

  // 1. Flip cross — the regime invalidator. Side is taken from where spot sits vs the flip (the same
  //    fact the verdict's regime read used), so it is a real falsifier of THIS read, not a template.
  if (spot != null && flip != null) {
    const above = spot >= flip;
    out.push(
      above
        ? {
            id: "flip_loss",
            effect: "invalidate",
            metric: "spot",
            op: "crosses_below",
            refLevel: flip,
            text: `INVALIDATED if spot closes below the ${fmt(flip)} gamma flip — that loses the long-gamma side the read is built on and flips the regime.`,
          }
        : {
            id: "flip_reclaim",
            effect: "invalidate",
            metric: "spot",
            op: "crosses_above",
            refLevel: flip,
            text: `INVALIDATED if spot reclaims above the ${fmt(flip)} gamma flip — that flips the short-gamma side the read is built on.`,
          }
    );
  }

  // 2. Aligned wall migration — WEAKENED when the thesis's target wall crosses to the wrong side of
  //    spot. For a bullish/long-side read the call wall overhead is the pin/target; if it migrates
  //    below spot it has stopped being resistance. Mirror for a bearish read's put wall.
  const wantsUpside = bias === "bullish" || (bias === "neutral" && spot != null && flip != null && spot >= flip);
  if (wantsUpside && callWall != null && spot != null && callWall > spot) {
    out.push({
      id: "call_wall_migrates_below_spot",
      effect: "weaken",
      metric: "call_wall",
      op: "migrates_below_spot",
      refLevel: callWall,
      text: `WEAKENED if the ${fmt(callWall)} call wall migrates below spot — the overhead magnet/target the read leans on would no longer be resistance.`,
    });
  }
  if (bias === "bearish" && putWall != null && spot != null && putWall < spot) {
    out.push({
      id: "put_wall_migrates_above_spot",
      effect: "weaken",
      metric: "put_wall",
      op: "migrates_above_spot",
      refLevel: putWall,
      text: `WEAKENED if the ${fmt(putWall)} put wall migrates above spot — the downside magnet the read leans on would no longer be support-turned-target.`,
    });
  }

  // 3. Max-pain migration across the flip — WEAKENED for a pinning (long-gamma) read: if the max-pain
  //    magnet moves to the other side of the flip, the pin that anchors the range read has left.
  if (ev.regime === "long" && maxPain != null && flip != null && spot != null) {
    const mpAbove = maxPain >= flip;
    const spotAbove = spot >= flip;
    if (mpAbove === spotAbove) {
      out.push({
        id: mpAbove ? "max_pain_crosses_below_flip" : "max_pain_crosses_above_flip",
        effect: "weaken",
        metric: "max_pain",
        op: mpAbove ? "crosses_below" : "crosses_above",
        refLevel: flip,
        text: `WEAKENED if max pain ${fmt(maxPain)} migrates to the other side of the ${fmt(flip)} flip — the pin anchoring the range read would flip sides.`,
      });
    }
  }

  return out;
}

/**
 * Evaluate ONE falsifier against a fresh snapshot, given the baseline snapshot captured at verdict
 * time (needed for the `crosses_*` predicates — a cross requires the metric to have been on the other
 * side then). PURE. `indeterminate` when a required value is missing now (never guessed).
 */
export function evaluateFalsifier(
  spec: BieFalsifier,
  baseline: FalsifierSnapshot,
  current: FalsifierSnapshot
): FalsifierStatus {
  const cur = metricValue(spec.metric, current);
  const label = METRIC_LABEL[spec.metric];
  const flip = (triggered: boolean, detail: string): FalsifierStatus => ({
    id: spec.id,
    effect: spec.effect,
    triggered,
    status: triggered ? (spec.effect === "invalidate" ? "invalidated" : "weakened") : "holding",
    detail,
  });
  const indet = (detail: string): FalsifierStatus => ({
    id: spec.id,
    effect: spec.effect,
    triggered: false,
    status: "indeterminate",
    detail,
  });

  if (cur == null) return indet(`${label} not live now — can't re-check this condition.`);

  switch (spec.op) {
    case "below":
      if (spec.refLevel == null) return indet(`no reference level to compare ${label} against.`);
      return flip(cur < spec.refLevel, `${label} ${fmt(cur)} vs ${fmt(spec.refLevel)} (${cur < spec.refLevel ? "below" : "at/above"}).`);
    case "above":
      if (spec.refLevel == null) return indet(`no reference level to compare ${label} against.`);
      return flip(cur > spec.refLevel, `${label} ${fmt(cur)} vs ${fmt(spec.refLevel)} (${cur > spec.refLevel ? "above" : "at/below"}).`);
    case "crosses_below": {
      if (spec.refLevel == null) return indet(`no reference level for the cross.`);
      const base = metricValue(spec.metric, baseline);
      const wasAtOrAbove = base == null || base >= spec.refLevel; // unknown baseline → treat as "was on the held side"
      return flip(wasAtOrAbove && cur < spec.refLevel, `${label} now ${fmt(cur)} vs ${fmt(spec.refLevel)}${base != null ? ` (was ${fmt(base)})` : ""}.`);
    }
    case "crosses_above": {
      if (spec.refLevel == null) return indet(`no reference level for the cross.`);
      const base = metricValue(spec.metric, baseline);
      const wasAtOrBelow = base == null || base <= spec.refLevel;
      return flip(wasAtOrBelow && cur > spec.refLevel, `${label} now ${fmt(cur)} vs ${fmt(spec.refLevel)}${base != null ? ` (was ${fmt(base)})` : ""}.`);
    }
    case "migrates_below_spot": {
      const spot = fin(current.spot);
      if (spot == null) return indet(`no live spot to place the ${label} against.`);
      return flip(cur <= spot, `${label} ${fmt(cur)} vs spot ${fmt(spot)} (${cur <= spot ? "at/below" : "above"}).`);
    }
    case "migrates_above_spot": {
      const spot = fin(current.spot);
      if (spot == null) return indet(`no live spot to place the ${label} against.`);
      return flip(cur >= spot, `${label} ${fmt(cur)} vs spot ${fmt(spot)} (${cur >= spot ? "at/above" : "below"}).`);
    }
  }
}

/** Overall re-check verdict for a pinned case. */
export type CaseReeval = {
  statuses: FalsifierStatus[];
  /** "holds" when nothing tripped; "invalidated" if any invalidator tripped; else "weakened". */
  overall: "holds" | "weakened" | "invalidated";
};

/** Evaluate every falsifier of a pinned verdict against a fresh snapshot and roll them up. PURE. */
export function reevaluateCase(
  falsifiers: BieFalsifier[],
  baseline: FalsifierSnapshot,
  current: FalsifierSnapshot
): CaseReeval {
  const statuses = falsifiers.map((f) => evaluateFalsifier(f, baseline, current));
  const anyInvalidated = statuses.some((s) => s.status === "invalidated");
  const anyWeakened = statuses.some((s) => s.status === "weakened");
  return {
    statuses,
    overall: anyInvalidated ? "invalidated" : anyWeakened ? "weakened" : "holds",
  };
}
