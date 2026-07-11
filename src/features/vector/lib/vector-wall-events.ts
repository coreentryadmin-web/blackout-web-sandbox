import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import {
  flipForLens,
  wallsForLens,
  type VectorWallLens,
  type WallHistorySample,
} from "./vector-wall-history";

export type VectorWallEventKind =
  | "call_wall_shift"
  | "put_wall_shift"
  | "flip_shift"
  | "spot_crossed_flip"
  | "spot_broke_call"
  | "spot_broke_put";

export type VectorWallEvent = {
  time: number;
  lens: VectorWallLens;
  kind: VectorWallEventKind;
  message: string;
  severity: "info" | "warn";
};

const MAX_EVENTS = 12;

/**
 * Two consecutive samples further apart than this are a discontinuity (SSE
 * reconnect, tab sleep, missed buckets), not an observed structural move —
 * diffing across the gap would fabricate a "shift" timestamped now for a
 * change that happened at an unknown time inside the gap. 8 buckets = 2 min.
 */
const MAX_DIFF_GAP_SEC = 120;

/**
 * A rank-1 wall "shift" is only real if the new top strike decisively
 * out-ranks the old one — rank-1/rank-2 near-ties otherwise flap the top
 * strike sample-to-sample and spam SHIFT events both ways. The new top must
 * beat the old top's concentration (as measured in the SAME new sample) by
 * this many percentage points, or the old top must be gone entirely.
 */
const SHIFT_DOMINANCE_PCT = 5;

function fmtStrike(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function topStrike(walls: GexWalls | null, side: "callWalls" | "putWalls"): number | null {
  const strike = walls?.[side][0]?.strike;
  return strike != null && Number.isFinite(strike) ? Math.round(strike) : null;
}

function lensLabels(lens: VectorWallLens) {
  return lens === "vex"
    ? { call: "Vanna +", put: "Vanna −", flip: "Vanna flip" }
    : { call: "Call wall", put: "Put wall", flip: "Gamma flip" };
}

/**
 * True when moving the rank-1 strike from prevTop to nextTop reflects a real
 * concentration change rather than a near-tie flapping. Judged entirely inside
 * the NEW sample: if the old top strike still appears there with pct within
 * SHIFT_DOMINANCE_PCT of the new top's, the ranking is noise-level.
 */
function shiftIsDominant(
  nextWalls: GexWalls | null,
  side: "callWalls" | "putWalls",
  prevTop: number,
  nextTop: number
): boolean {
  const levels = nextWalls?.[side] ?? [];
  const next = levels.find((l) => Math.round(l.strike) === nextTop);
  const prevInNext = levels.find((l) => Math.round(l.strike) === prevTop);
  if (!next) return false;
  if (!prevInNext) return true; // old top left the board entirely — structural
  return next.pct - prevInNext.pct >= SHIFT_DOMINANCE_PCT;
}

/** Diff two consecutive wall-history samples for the active lens. */
export function diffVectorWallSample(
  prev: WallHistorySample | null,
  next: WallHistorySample,
  lens: VectorWallLens
): VectorWallEvent[] {
  // Same-bucket re-observations (prev.time === next.time) are 1s ticks inside
  // one 15s sample bucket, not a new observation — diffing them emits an event
  // per tick for a single underlying change.
  if (!prev || prev.time >= next.time) return [];
  if (next.time - prev.time > MAX_DIFF_GAP_SEC) return [];

  const labels = lensLabels(lens);
  const events: VectorWallEvent[] = [];
  const prevWalls = wallsForLens(prev, lens);
  const nextWalls = wallsForLens(next, lens);

  const prevCall = topStrike(prevWalls, "callWalls");
  const nextCall = topStrike(nextWalls, "callWalls");
  if (
    prevCall != null &&
    nextCall != null &&
    prevCall !== nextCall &&
    shiftIsDominant(nextWalls, "callWalls", prevCall, nextCall)
  ) {
    events.push({
      time: next.time,
      lens,
      kind: "call_wall_shift",
      severity: "info",
      message: `${labels.call} shifted ${fmtStrike(prevCall)} → ${fmtStrike(nextCall)}`,
    });
  }

  const prevPut = topStrike(prevWalls, "putWalls");
  const nextPut = topStrike(nextWalls, "putWalls");
  if (
    prevPut != null &&
    nextPut != null &&
    prevPut !== nextPut &&
    shiftIsDominant(nextWalls, "putWalls", prevPut, nextPut)
  ) {
    events.push({
      time: next.time,
      lens,
      kind: "put_wall_shift",
      severity: "info",
      message: `${labels.put} shifted ${fmtStrike(prevPut)} → ${fmtStrike(nextPut)}`,
    });
  }

  const prevFlip = flipForLens(prev, lens);
  const nextFlip = flipForLens(next, lens);
  // Compare at display precision: the flip is an interpolated zero-crossing
  // whose decimals drift nearly every sample, and history copies of the same
  // reading can differ only in precision (raw vs wire-rounded). Comparing raw
  // floats fabricated "Gamma flip moved 6,745 → 6,745" events; the member-
  // visible message rounds, so the comparison must too.
  if (
    prevFlip != null &&
    nextFlip != null &&
    Math.round(prevFlip) !== Math.round(nextFlip)
  ) {
    events.push({
      time: next.time,
      lens,
      kind: "flip_shift",
      severity: "info",
      message: `${labels.flip} moved ${fmtStrike(prevFlip)} → ${fmtStrike(nextFlip)}`,
    });
  }

  return events;
}

/**
 * Spot vs structure crosses between two ~1s ticks (same lens overlays).
 *
 * prevWalls/prevFlip (when provided) enforce LEVEL STABILITY: a "break" is
 * only real if the level itself sat still while spot moved across it. Without
 * this, one bad GEX snapshot that relocates the call wall from 6810 to 6800.3
 * over a flat 6800.2→6800.4 spot fabricates "resistance gave way" with zero
 * price action — the level crossed the spot, not the other way around.
 */
export function detectSpotStructureEvents(
  prevSpot: number | null,
  curSpot: number | null,
  walls: GexWalls | null,
  flip: number | null,
  lens: VectorWallLens,
  time: number,
  prevWalls?: GexWalls | null,
  prevFlip?: number | null
): VectorWallEvent[] {
  if (prevSpot == null || curSpot == null || prevSpot <= 0 || curSpot <= 0) return [];

  const labels = lensLabels(lens);
  const events: VectorWallEvent[] = [];

  const flipStable =
    prevFlip === undefined ||
    (prevFlip != null && flip != null && Math.round(prevFlip) === Math.round(flip));
  if (flip != null && flip > 0 && flipStable) {
    const wasAbove = prevSpot >= flip;
    const isAbove = curSpot >= flip;
    if (wasAbove !== isAbove) {
      events.push({
        time,
        lens,
        kind: "spot_crossed_flip",
        severity: isAbove ? "info" : "warn",
        message: isAbove
          ? `SPX crossed above ${labels.flip.toLowerCase()} ${fmtStrike(flip)} — supportive dealer hedging`
          : `SPX crossed below ${labels.flip.toLowerCase()} ${fmtStrike(flip)} — momentum / vol expansion risk`,
      });
    }
  }

  const callWall = topStrike(walls, "callWalls");
  const callStable =
    prevWalls === undefined || (callWall != null && topStrike(prevWalls ?? null, "callWalls") === callWall);
  if (callWall != null && callStable && prevSpot <= callWall && curSpot > callWall) {
    events.push({
      time,
      lens,
      kind: "spot_broke_call",
      severity: "warn",
      message: `SPX broke above ${labels.call.toLowerCase()} ${fmtStrike(callWall)} — resistance gave way`,
    });
  }

  const putWall = topStrike(walls, "putWalls");
  const putStable =
    prevWalls === undefined || (putWall != null && topStrike(prevWalls ?? null, "putWalls") === putWall);
  if (putWall != null && putStable && prevSpot >= putWall && curSpot < putWall) {
    events.push({
      time,
      lens,
      kind: "spot_broke_put",
      severity: "warn",
      message: `SPX broke below ${labels.put.toLowerCase()} ${fmtStrike(putWall)} — support gave way`,
    });
  }

  return events;
}

export function appendVectorWallEvents(
  events: VectorWallEvent[],
  incoming: VectorWallEvent[]
): VectorWallEvent[] {
  if (!incoming.length) return events;
  const merged = [...events, ...incoming];
  return merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
}

/** Walk history tail and emit structure-shift events for replay seeding. */
export function eventsFromWallHistory(
  history: WallHistorySample[],
  lens: VectorWallLens
): VectorWallEvent[] {
  let events: VectorWallEvent[] = [];
  for (let i = 1; i < history.length; i++) {
    events = appendVectorWallEvents(events, diffVectorWallSample(history[i - 1]!, history[i]!, lens));
  }
  return events;
}
