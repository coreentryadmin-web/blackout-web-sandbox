// CORTEX SOURCE: Helix flow quality — print texture, not just aggregates.
// Design doc §1 "Helix": 0DTE Command already keys on flow aggregates; Helix adds
// print-level texture. Sweep CLUSTERS (urgency) aligned with the play = support;
// an OPPOSING block/sweep cluster ≥$1M within 15 min is veto-grade for new commits.
// "Single-print conviction is a trap — only clusters count."

import type { CortexFlowPrint, CortexInputs, EvidenceItem } from "../types";
import { absentForMissingSlice, fmtMillions, parseMs } from "./shared";

/** 15-min cluster window — design §1 verbatim ("opposing block/sweep cluster ≥$1M
 *  within 15 min = veto-grade for NEW commits"). Both the veto and the aligned
 *  support read the same window so "recent flow" means one thing. */
export const FLOW_CLUSTER_WINDOW_SEC = 15 * 60;

/** Opposing-cluster veto floor — design §1 verbatim: ≥$1M. */
export const OPPOSING_CLUSTER_VETO_PREMIUM = 1_000_000;

/** An opposing cluster needs ≥2 prints: "cluster" is plural by definition and a
 *  single print — even a loud one — is the exact trap the design calls out. Two
 *  urgent opposing prints crossing $1M inside 15 min is institutionally deliberate. */
export const OPPOSING_CLUSTER_MIN_PRINTS = 2;

/** Aligned-support premium floor: $750k gross — the same gross-premium bar 0DTE
 *  Command's own evidence gate uses for a setup (NIGHTHAWK-VS-SLAYER-0DTE.md §1.2,
 *  deriveZeroDteSetups gate 1), so Cortex support means "would clear the scanner's
 *  own conviction floor", not a weaker private standard. */
export const ALIGNED_CLUSTER_MIN_PREMIUM = 750_000;

/** Aligned support needs ≥3 prints — one MORE than the veto's floor on purpose:
 *  precision-first asymmetry (design §0) makes support harder to earn than a block. */
export const ALIGNED_CLUSTER_MIN_PRINTS = 3;

/** Raw weight of an aligned sweep cluster. 0.75 — below the 1.0 structural unit:
 *  flow direction ≠ intent (design §1 "lies when": hedges/rolls read as aggression),
 *  so urgency texture supports but never leads the structural reads. */
export const FLOW_SUPPORT_WEIGHT = 0.75;

/** Per-source support cap — one aligned-cluster support is all this source can say. */
export const FLOW_SUPPORT_CAP = 0.75;

/** Half-life 15 min, matching the cluster window: a cluster older than its own
 *  window is no longer "flow behind the setup", it is history. */
export const FLOW_HALF_LIFE_SEC = 15 * 60;

export type FlowCluster = {
  prints: number;
  totalPremium: number;
  sweeps: number;
  blocks: number;
  /** ISO time of the newest print in the cluster — the evidence asOf. */
  newestAt: string;
};

/**
 * Collect the in-window cluster of urgent prints (sweeps + blocks only — "other"
 * texture carries no urgency signal) on one side of the tape. Prints with no real
 * timestamp ("" — the parser's honesty sentinel) are EXCLUDED from time-windowed
 * clusters rather than assumed fresh. Exported for catalyst-news (which upgrades
 * conviction only when a catalyst coincides with this exact aligned cluster) and
 * for the narrative guard test (premium totals in details are recomputed here).
 */
export function findFlowCluster(
  prints: CortexFlowPrint[],
  side: "bullish" | "bearish",
  nowMs: number
): FlowCluster | null {
  const windowStartMs = nowMs - FLOW_CLUSTER_WINDOW_SEC * 1000;
  let total = 0;
  let count = 0;
  let sweeps = 0;
  let blocks = 0;
  let newestMs = -Infinity;
  for (const p of prints) {
    if (p.direction !== side) continue;
    if (p.kind !== "sweep" && p.kind !== "block") continue;
    const at = parseMs(p.at);
    if (at == null || at < windowStartMs || at > nowMs) continue;
    if (!Number.isFinite(p.premium) || p.premium <= 0) continue;
    total += p.premium;
    count += 1;
    if (p.kind === "sweep") sweeps += 1;
    else blocks += 1;
    if (at > newestMs) newestMs = at;
  }
  if (count === 0) return null;
  return {
    prints: count,
    totalPremium: total,
    sweeps,
    blocks,
    newestAt: new Date(newestMs).toISOString(),
  };
}

export function deriveFlowQualityEvidence(input: CortexInputs): EvidenceItem[] {
  const { flow, direction } = input;
  if (!flow) return [absentForMissingSlice("flow-quality", input, "no flow tape for the ticker")];
  const nowMs = parseMs(input.now);
  if (nowMs == null) return [absentForMissingSlice("flow-quality", input, "invalid now timestamp")];

  const alignedSide = direction === "long" ? "bullish" : "bearish";
  const opposingSide = direction === "long" ? "bearish" : "bullish";
  const aligned = findFlowCluster(flow.prints, alignedSide, nowMs);
  const opposing = findFlowCluster(flow.prints, opposingSide, nowMs);

  const items: EvidenceItem[] = [];

  if (
    opposing &&
    opposing.totalPremium >= OPPOSING_CLUSTER_VETO_PREMIUM &&
    opposing.prints >= OPPOSING_CLUSTER_MIN_PRINTS
  ) {
    items.push({
      source: "flow-quality",
      stance: "veto",
      // Weight scales the veto's loudness for the evidence table (multiples of the
      // $1M floor); the block itself is binary regardless.
      weight: opposing.totalPremium / OPPOSING_CLUSTER_VETO_PREMIUM,
      halfLifeSec: FLOW_HALF_LIFE_SEC,
      asOf: opposing.newestAt,
      detail:
        `opposing ${opposingSide} sweep/block cluster ${fmtMillions(opposing.totalPremium)} across ` +
        `${opposing.prints} prints (${opposing.sweeps} sweeps, ${opposing.blocks} blocks) inside the 15-min window.`,
    });
  }

  if (
    aligned &&
    aligned.totalPremium >= ALIGNED_CLUSTER_MIN_PREMIUM &&
    aligned.prints >= ALIGNED_CLUSTER_MIN_PRINTS &&
    aligned.sweeps > 0 // urgency support requires at least one true sweep, not a pure block stack
  ) {
    items.push({
      source: "flow-quality",
      stance: "supports",
      weight: FLOW_SUPPORT_WEIGHT,
      halfLifeSec: FLOW_HALF_LIFE_SEC,
      asOf: aligned.newestAt,
      detail:
        `aligned ${alignedSide} sweep cluster ${fmtMillions(aligned.totalPremium)} across ` +
        `${aligned.prints} prints (${aligned.sweeps} sweeps, ${aligned.blocks} blocks) inside the 15-min window.`,
    });
  }

  if (items.length === 0) {
    return [
      absentForMissingSlice(
        "flow-quality",
        input,
        "no qualifying sweep/block cluster on either side inside the 15-min window"
      ),
    ];
  }
  return items;
}
