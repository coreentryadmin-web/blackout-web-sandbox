import { playThesisBreakDropPts, playThesisBreakScore } from "@/features/spx/lib/spx-play-config";
import type { SpxPlayDirection } from "@/features/spx/lib/spx-signals";

export type ThesisBreakDetail = {
  broken: boolean;
  /** Effective threshold on the confluence score axis (primary branch when broken) */
  threshold: number;
  /** Which OR branch fired: drop from entry vs absolute floor */
  trigger: "drop" | "floor" | null;
};

/**
 * Thesis break uses OR logic (either condition flattens):
 *
 * LONG:  score <= entry - effectiveDrop  OR  score <= -floor
 * SHORT: score >= entry + effectiveDrop  OR  score >= +floor
 *
 * effectiveDrop = max(dropPts, |entryScore| * 0.25)
 * This prevents hair-trigger thesis breaks on low-confidence entries (e.g. score -50)
 * where a flat dropPts=12 would only allow a 12pt reversal before breaking the thesis.
 * With the 25% floor, a -50 entry requires a 12.5pt reversal minimum (capped by dropPts
 * if dropPts is already larger than 25% of entryScore).
 */
export function evaluateThesisBreak(
  direction: SpxPlayDirection,
  score: number,
  entryScore: number,
  opts?: { dropPts?: number; floor?: number }
): ThesisBreakDetail {
  const dropPts = opts?.dropPts ?? playThesisBreakDropPts();
  const floor = opts?.floor ?? playThesisBreakScore();
  // Effective drop: at least 25% of the entry score magnitude so low-confidence
  // entries aren't killed by a small noise reversal.
  const effectiveDrop = Math.max(dropPts, Math.abs(entryScore) * 0.25);

  if (direction === "long") {
    const dropThreshold = entryScore - effectiveDrop;
    const floorThreshold = -floor;
    const dropBroken = score <= dropThreshold;
    const floorBroken = score <= floorThreshold;
    const broken = dropBroken || floorBroken;
    const threshold = dropBroken ? dropThreshold : floorBroken ? floorThreshold : dropThreshold;
    const trigger = !broken ? null : dropBroken ? "drop" : "floor";
    return { broken, threshold, trigger };
  }

  const dropThreshold = entryScore + effectiveDrop;
  const floorThreshold = floor;
  const dropBroken = score >= dropThreshold;
  const floorBroken = score >= floorThreshold;
  const broken = dropBroken || floorBroken;
  const threshold = dropBroken ? dropThreshold : floorBroken ? floorThreshold : dropThreshold;
  const trigger = !broken ? null : dropBroken ? "drop" : "floor";
  return { broken, threshold, trigger };
}
