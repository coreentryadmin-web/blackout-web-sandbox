import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { VectorWallLens, WallHistorySample } from "./vector-wall-history";
import { flipForLens, wallsForLens } from "./vector-wall-history";
import { etClock, etMinutes } from "@/features/spx/lib/spx-play-session-time";

export type VectorReplayBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** Sorted union of wall-sample times and candle bar times — replay scrubber steps. */
export function buildReplayTimeline(
  history: WallHistorySample[],
  bars: VectorReplayBar[]
): number[] {
  const times = new Set<number>();
  for (const sample of history) times.add(sample.time);
  for (const bar of bars) times.add(bar.time);
  return [...times].sort((a, b) => a - b);
}

export function sliceHistoryToTime(
  history: WallHistorySample[],
  cursorTime: number
): WallHistorySample[] {
  return history.filter((s) => s.time <= cursorTime);
}

export function sliceBarsToTime(bars: VectorReplayBar[], cursorTime: number): VectorReplayBar[] {
  return bars.filter((b) => b.time <= cursorTime);
}

/** Latest wall ladder at or before the replay cursor. */
export function wallsAtReplayTime(
  history: WallHistorySample[],
  cursorTime: number,
  lens: VectorWallLens = "gex"
): GexWalls | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const sample = history[i];
    if (sample.time <= cursorTime) return wallsForLens(sample, lens);
  }
  return null;
}

/** Latest flip level at or before the replay cursor. */
export function flipAtReplayTime(
  history: WallHistorySample[],
  cursorTime: number,
  lens: VectorWallLens = "gex"
): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const sample = history[i];
    if (sample.time <= cursorTime) return flipForLens(sample, lens);
  }
  return null;
}

/** @deprecated Use flipAtReplayTime(history, t, "gex") */
export function gammaFlipAtReplayTime(history: WallHistorySample[], cursorTime: number): number | null {
  return flipAtReplayTime(history, cursorTime, "gex");
}

export function wallsForActiveLens(
  lens: VectorWallLens,
  gex: GexWalls | null,
  vex: GexWalls | null
): GexWalls | null {
  return lens === "vex" ? vex : gex;
}

export function flipForActiveLens(lens: VectorWallLens, gammaFlip: number | null, vexFlip: number | null): number | null {
  return lens === "vex" ? vexFlip : gammaFlip;
}

/**
 * Wall ladder for the chart's crosshair legend. When hovering a point in time (replay
 * or a scrub), returns the historical sample AS OF that hover time, never today's live
 * ladder — `wallsAtReplayTime` only returns null when hoverEpochSec predates the earliest
 * recorded sample (any cursor at/after history[0].time always matches at least that
 * sample), meaning genuinely no wall data existed yet at that point in the session.
 * Falling back to live there would mislabel today's current walls as the historical state
 * at the hovered time — same bug shape as a sticky status whose narrative stops checking
 * whether it still reflects reality. Live is only the right answer when NOT hovering
 * (hoverEpochSec null — crosshair off the chart) or when no history has ever been
 * recorded (nothing else to show).
 */
export function wallsAtCrosshairTime(
  history: WallHistorySample[],
  hoverEpochSec: number | null,
  activeLens: VectorWallLens,
  gexLive: GexWalls | null,
  vexLive: GexWalls | null
): GexWalls | null {
  if (hoverEpochSec != null && history.length > 0) {
    return wallsAtReplayTime(history, hoverEpochSec, activeLens);
  }
  return wallsForActiveLens(activeLens, gexLive, vexLive);
}

/** Same reasoning as wallsAtCrosshairTime above — no live fallback once history exists. */
export function flipAtCrosshairTime(
  history: WallHistorySample[],
  hoverEpochSec: number | null,
  activeLens: VectorWallLens,
  gammaLive: number | null,
  vexLive: number | null
): number | null {
  if (hoverEpochSec != null && history.length > 0) {
    const lensKey = activeLens === "vex" ? "vex" : "gex";
    return flipAtReplayTime(history, hoverEpochSec, lensKey);
  }
  return flipForActiveLens(activeLens, gammaLive, vexLive);
}

/** Format a unix-second timestamp for the replay scrubber (ET). */
export function formatReplayClock(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function sessionYmdForEpoch(epochSec: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date(epochSec * 1000));
}

/** Index of first timeline step at or after an ET clock on the session day. */
export function timelineIndexAtOrAfterEtClock(
  timeline: number[],
  sessionYmd: string,
  hour: number,
  minute: number
): number {
  if (!timeline.length) return 0;
  const target = etClock(hour, minute);
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i]!;
    if (sessionYmdForEpoch(t) !== sessionYmd) continue;
    if (etMinutes(new Date(t * 1000)) >= target) return i;
  }
  return timeline.length - 1;
}

/** Index of last timeline step at or before an ET clock on the session day. */
export function timelineIndexAtOrBeforeEtClock(
  timeline: number[],
  sessionYmd: string,
  hour: number,
  minute: number
): number {
  if (!timeline.length) return 0;
  const target = etClock(hour, minute);
  let best = 0;
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i]!;
    if (sessionYmdForEpoch(t) !== sessionYmd) continue;
    const mins = etMinutes(new Date(t * 1000));
    if (mins <= target) best = i;
    else break;
  }
  return best;
}

export function clampTimelineIndex(timeline: number[], index: number): number {
  if (!timeline.length) return 0;
  return Math.max(0, Math.min(timeline.length - 1, index));
}
