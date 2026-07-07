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

/** Diff two consecutive wall-history samples for the active lens. */
export function diffVectorWallSample(
  prev: WallHistorySample | null,
  next: WallHistorySample,
  lens: VectorWallLens
): VectorWallEvent[] {
  if (!prev || prev.time > next.time) return [];

  const labels = lensLabels(lens);
  const events: VectorWallEvent[] = [];
  const prevWalls = wallsForLens(prev, lens);
  const nextWalls = wallsForLens(next, lens);

  const prevCall = topStrike(prevWalls, "callWalls");
  const nextCall = topStrike(nextWalls, "callWalls");
  if (prevCall != null && nextCall != null && prevCall !== nextCall) {
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
  if (prevPut != null && nextPut != null && prevPut !== nextPut) {
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
  if (prevFlip != null && nextFlip != null && prevFlip !== nextFlip) {
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

/** Spot vs structure crosses between two ~1s ticks (same lens overlays). */
export function detectSpotStructureEvents(
  prevSpot: number | null,
  curSpot: number | null,
  walls: GexWalls | null,
  flip: number | null,
  lens: VectorWallLens,
  time: number
): VectorWallEvent[] {
  if (prevSpot == null || curSpot == null || prevSpot <= 0 || curSpot <= 0) return [];

  const labels = lensLabels(lens);
  const events: VectorWallEvent[] = [];

  if (flip != null && flip > 0) {
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
  if (callWall != null && prevSpot <= callWall && curSpot > callWall) {
    events.push({
      time,
      lens,
      kind: "spot_broke_call",
      severity: "warn",
      message: `SPX broke above ${labels.call.toLowerCase()} ${fmtStrike(callWall)} — resistance gave way`,
    });
  }

  const putWall = topStrike(walls, "putWalls");
  if (putWall != null && prevSpot >= putWall && curSpot < putWall) {
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
