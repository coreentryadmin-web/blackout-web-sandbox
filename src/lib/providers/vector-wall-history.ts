import type { GexWalls } from "@/lib/providers/gex-wall-levels";

/** Wall overlay lens — GEX from live dealer-gamma ladder; VEX from shared heatmap vanna totals. */
export type VectorWallLens = "gex" | "vex";

export type WallHistorySample = {
  time: number;
  /** GEX (dealer gamma) walls — live via UW WS with heatmap fallback. */
  walls: GexWalls;
  gammaFlip?: number | null;
  /** VEX (dealer vanna) walls — heatmap cache (~8s SPX). Omitted on legacy Redis rows. */
  vexWalls?: GexWalls | null;
  vexFlip?: number | null;
};

export function wallsForLens(sample: WallHistorySample, lens: VectorWallLens): GexWalls | null {
  if (lens === "vex") return sample.vexWalls ?? null;
  return sample.walls;
}

export function flipForLens(sample: WallHistorySample, lens: VectorWallLens): number | null {
  const flip = lens === "vex" ? sample.vexFlip : sample.gammaFlip;
  return flip != null && Number.isFinite(flip) && flip > 0 ? flip : null;
}

export function hasVexInHistory(history: WallHistorySample[]): boolean {
  return history.some((s) => Boolean(s.vexWalls?.callWalls?.length || s.vexWalls?.putWalls?.length));
}

export type StrikeTrailPoint = { time: number; pct: number };

// ~one RTH session at 15s trail cadence (390 min × 4 ≈ 1560) plus headroom.
const MAX_HISTORY = 1920;

/** Max simultaneous strike-keyed bead rows per side on the chart (reference shows ~4–6). */
export const MAX_STRIKE_TRAILS_PER_SIDE = 8;

/** Live session: only render wall beads within this many seconds of the chart's leading edge. */
export const LIVE_TRAIL_LOOKBACK_SEC = 45 * 60;

/**
 * Append a wall reading into the session's history, keyed by the trail bucket time (15s by
 * default — see vector-wall-sample.ts). Replaces in place when the bucket is unchanged so
 * magnitude updates within the same 15s window don't duplicate beads.
 */
export function recordWallSample(history: WallHistorySample[], sample: WallHistorySample): WallHistorySample[] {
  const last = history[history.length - 1];
  const next = last && last.time === sample.time ? [...history.slice(0, -1), sample] : [...history, sample];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/**
 * Project the history down to one side's (call or put) rank-`i` trail as plain
 * {time, strike, pct} points — a bar where that rank didn't exist (e.g. the ladder briefly
 * thinned to fewer distinct strikes) is simply omitted, not filled with a placeholder, so the
 * rendered trail has a genuine gap rather than a misleading flat/zero value.
 */
export function trailForRank(
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  rank: number
): Array<{ time: number; strike: number; pct: number }> {
  const points: Array<{ time: number; strike: number; pct: number }> = [];
  for (const sample of history) {
    const level = sample.walls[side][rank];
    if (level) points.push({ time: sample.time, strike: level.strike, pct: level.pct });
  }
  return points;
}

/**
 * Strike-keyed trails — each strike gets its own horizontal bead row (reference product style).
 * When a wall migrates from 7550 → 7575 you see two distinct horizontal trails, not a diagonal
 * scatter from rank-based projection.
 */
export function trailsByStrike(
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  lens: VectorWallLens = "gex"
): Map<number, StrikeTrailPoint[]> {
  const map = new Map<number, StrikeTrailPoint[]>();
  for (const sample of history) {
    const walls = wallsForLens(sample, lens);
    if (!walls) continue;
    for (const level of walls[side]) {
      const strike = Math.round(level.strike);
      if (!Number.isFinite(strike)) continue;
      let pts = map.get(strike);
      if (!pts) {
        pts = [];
        map.set(strike, pts);
      }
      const last = pts[pts.length - 1];
      if (last?.time === sample.time) {
        pts[pts.length - 1] = { time: sample.time, pct: level.pct };
      } else {
        pts.push({ time: sample.time, pct: level.pct });
      }
    }
  }
  return map;
}

/** Weight a strike row by cumulative magnitude so dominant walls stay visible when capping. */
export function strikeTrailWeight(points: StrikeTrailPoint[]): number {
  return points.reduce((sum, p) => sum + p.pct, 0);
}

/** Pick the top-N strike rows to render (by cumulative |gamma| share across the session). */
export function pickActiveStrikes(
  trails: Map<number, StrikeTrailPoint[]>,
  maxStrikes: number = MAX_STRIKE_TRAILS_PER_SIDE
): number[] {
  return [...trails.entries()]
    .sort((a, b) => strikeTrailWeight(b[1]) - strikeTrailWeight(a[1]))
    .slice(0, maxStrikes)
    .map(([strike]) => strike);
}

/** Anchor live trail trimming to the latest candle or wall sample — not wall-clock alone. */
export function liveTrailAnchorSec(
  history: WallHistorySample[],
  barTimes: number[] = []
): number {
  const historyTail = history[history.length - 1]?.time ?? 0;
  const barTail = barTimes.length ? barTimes[barTimes.length - 1]! : 0;
  return Math.max(historyTail, barTail) || Math.floor(Date.now() / 1000);
}

/**
 * Drop wall-history samples older than the live lookback window so migrated strikes do not
 * leave stale horizontal bead rows across the chart all session.
 */
export function trimHistoryForLiveTrails(
  history: WallHistorySample[],
  lookbackSec: number = LIVE_TRAIL_LOOKBACK_SEC,
  anchorSec?: number
): WallHistorySample[] {
  if (!history.length) return history;
  const anchor = anchorSec ?? history[history.length - 1]!.time;
  const cutoff = anchor - lookbackSec;
  return history.filter((s) => s.time >= cutoff);
}

/**
 * When no per-bar history exists yet (fresh deploy / first page load off-hours), seed ONE
 * honest sample at the last visible candle bar with the current wall ladder — dots land at
 * session close on the right edge of the chart instead of a trail-less void. Does not invent
 * historical points across earlier bars (no GEX time-series source for backfill).
 */
export function seedWallHistoryForDisplay(
  history: WallHistorySample[],
  barTimes: number[],
  walls: GexWalls | null | undefined,
  gammaFlip?: number | null,
  vexWalls?: GexWalls | null,
  vexFlip?: number | null
): WallHistorySample[] {
  if (history.length > 0 || barTimes.length === 0) return history;
  const hasGex = Boolean(walls?.callWalls?.length || walls?.putWalls?.length);
  const hasVex = Boolean(vexWalls?.callWalls?.length || vexWalls?.putWalls?.length);
  if (!hasGex && !hasVex) return history;
  const lastTime = barTimes[barTimes.length - 1]!;
  if (!Number.isFinite(lastTime)) return history;
  return recordWallSample([], {
    time: lastTime,
    walls: walls ?? { callWalls: [], putWalls: [] },
    gammaFlip: gammaFlip ?? null,
    vexWalls: hasVex ? vexWalls : null,
    vexFlip: vexFlip ?? null,
  });
}

/** Merge server-observed history into the client buffer — union by bar time, longer tail wins ties. */
export function mergeWallHistory(
  local: WallHistorySample[],
  remote: WallHistorySample[] | null | undefined
): WallHistorySample[] {
  if (!remote?.length) return local;
  if (!local.length) return remote;
  const byTime = new Map<number, WallHistorySample>();
  for (const sample of local) byTime.set(sample.time, sample);
  for (const sample of remote) byTime.set(sample.time, sample);
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  return merged.length > MAX_HISTORY ? merged.slice(merged.length - MAX_HISTORY) : merged;
}

/** Flip bead trail for the active lens (gamma flip or zero-vanna flip). */
export function trailForFlipLevel(
  history: WallHistorySample[],
  lens: VectorWallLens = "gex"
): Array<{ time: number; strike: number }> {
  const points: Array<{ time: number; strike: number }> = [];
  for (const sample of history) {
    const flip = flipForLens(sample, lens);
    if (flip != null) points.push({ time: sample.time, strike: Math.round(flip) });
  }
  return points;
}

/** @deprecated Use trailForFlipLevel(history, "gex") */
export function trailForGammaFlip(history: WallHistorySample[]): Array<{ time: number; strike: number }> {
  return trailForFlipLevel(history, "gex");
}
