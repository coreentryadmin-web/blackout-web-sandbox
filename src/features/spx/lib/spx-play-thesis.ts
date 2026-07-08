import {
  playThesisBreakDropPts,
  playThesisBreakMinHoldSec,
  playThesisBreakMinMfePts,
  playThesisBreakScore,
} from "@/features/spx/lib/spx-play-config";
import type { SpxPlayDirection } from "@/features/spx/lib/spx-signals";

export type ThesisBreakDetail = {
  broken: boolean;
  /** Effective threshold on the confluence score axis (primary branch when broken) */
  threshold: number;
  /** Which OR branch fired: drop from entry vs absolute floor */
  trigger: "drop" | "floor" | null;
};

/** Optional open-play context for score-drop deferral (floor breaks stay immediate). */
export type ThesisBreakContext = {
  mfePts: number;
  openedAtMs: number;
  nowMs?: number;
};

/**
 * Thesis break uses OR logic (either condition flattens):
 *
 * LONG:  score <= entry - effectiveDrop  OR  score <= -floor
 * SHORT: score >= entry + effectiveDrop  OR  score >= +floor
 *
 * effectiveDrop = max(dropPts, |entryScore| * 0.25)
 */
export function evaluateThesisBreak(
  direction: SpxPlayDirection,
  score: number,
  entryScore: number,
  opts?: { dropPts?: number; floor?: number }
): ThesisBreakDetail {
  const dropPts = opts?.dropPts ?? playThesisBreakDropPts();
  const floor = opts?.floor ?? playThesisBreakScore();
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

/**
 * Open-play thesis evaluation: floor breaks fire immediately; score-drop breaks defer until
 * the trade has earned min MFE and min hold time (mixed-tape score noise otherwise flat at scratch).
 */
export function evaluateOpenThesisBreak(
  direction: SpxPlayDirection,
  score: number,
  entryScore: number,
  ctx: ThesisBreakContext,
  opts?: { dropPts?: number; floor?: number }
): ThesisBreakDetail {
  const raw = evaluateThesisBreak(direction, score, entryScore, opts);
  if (!raw.broken || raw.trigger === "floor") return raw;

  const nowMs = ctx.nowMs ?? Date.now();
  const holdSec = (nowMs - ctx.openedAtMs) / 1000;
  const minMfe = playThesisBreakMinMfePts();
  const minHold = playThesisBreakMinHoldSec();

  if (ctx.mfePts < minMfe || holdSec < minHold) {
    return { broken: false, threshold: raw.threshold, trigger: null };
  }

  return raw;
}
