// CORTEX SOURCE: Vector bead HISTORY — the wall-lifecycle trend. THE FLAGSHIP.
// Design doc §1 "Vector bead HISTORY (UNIQUE TO US)" + §3 breakthrough 3: a wall's
// strength TREND is more predictive than its level — trading toward a FADING wall
// (beads dimming over the last 30–60 min) is path-clearing (support); toward a
// BUILDING wall is path-hardening (oppose). King-node migration direction is a
// dealer-intent vector. "Lies when: recorder gaps — require ≥N samples in the trend
// window before speaking" — below the floor this source is ABSENT, never guessed.
//
// Consumes the rail via CortexInputs.wallTrend (fetch.ts maps WallHistorySample rows
// from src/features/vector/lib/vector-wall-persist.ts / vector-wall-history.ts) —
// no Vector internals are imported into the composer.

import type { CortexInputs, CortexWallTrendSample, EvidenceItem } from "../types";
import { absentForMissingSlice, fmtNum, parseMs } from "./shared";

/** 45-min trend window — the middle of the design's "last 30–60 min" band (§1), and
 *  exactly Vector's own live-trail lookback (LIVE_TRAIL_LOOKBACK_SEC = 45 min,
 *  vector-wall-history.ts), so the Cortex judges the same rail span a member sees. */
export const TREND_WINDOW_SEC = 45 * 60;

/** Minimum rail samples in-window before this source may speak (design §1 "require
 *  ≥N samples"). 8 samples ≈ 2 min of the 15s recorder cadence: enough points for a
 *  meaningful least-squares slope, small enough that ordinary recorder gaps
 *  (viewer-less names, restarts) don't permanently silence the flagship. */
export const MIN_TREND_SAMPLES = 8;

/** Slope floor, in pct-points of ladder share per HOUR, below which the opposing
 *  wall is "flat", not fading/building. Dominant walls typically hold 10–30% of
 *  ladder |gamma| (see computeGexWalls); 3 pct-pts/hr is a visibly dimming/brightening
 *  bead row rather than sample noise. */
export const TREND_SLOPE_MIN_PCT_PTS_PER_HOUR = 3;

/** Raw weight of a fading/building opposing wall. 1.25 — deliberately the LARGEST
 *  single support on the board (vs the 1.0 gex-walls unit): the design names the
 *  wall-trend factor the flagship differentiator ("nobody else has intraday wall
 *  history", §1; breakthrough §3.3 "ship it early"). Still well under any veto. */
export const WALL_TREND_WEIGHT = 1.25;

/** Raw weight of king-node migration toward/away from the target — a secondary
 *  dealer-intent vector (§1), sized at the small-signal tier. */
export const KING_MIGRATION_WEIGHT = 0.5;

/** Per-source support cap: slope + king migration may stack, but never past 1.5 —
 *  even the flagship cannot buy an entry alone (design §0 veto asymmetry: capped
 *  supports, unbounded vetoes). */
export const WALL_TREND_SUPPORT_CAP = 1.5;

/** Half-life 10 min — the shortest on the board: a strength TREND is a statement
 *  about what dealers are doing RIGHT NOW; a 30-min-old trend read is history, not
 *  intent (design §0 evidence decay / §3.4 "alpha that expires"). */
export const WALL_TREND_HALF_LIFE_SEC = 10 * 60;

/** Least-squares slope of (timeSec, pct) points, returned in pct-pts per HOUR.
 *  Exported for the narrative guard test (the slope in the detail sentence is a
 *  documented derivation of the rail samples — the guard recomputes it here). */
export function railSlopePctPerHour(points: Array<{ timeSec: number; pct: number }>): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const t0 = points[0].timeSec;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of points) {
    const x = (p.timeSec - t0) / 3600; // hours from window start
    sumX += x;
    sumY += p.pct;
    sumXY += x * p.pct;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

/** The strongest strike across BOTH sides of a sample — the king node (mirrors
 *  gex-positioning's gex_king_strike: argmax |net-gamma|, either sign). */
export function kingStrikeOfSample(sample: CortexWallTrendSample): number | null {
  let best: { strike: number; pct: number } | null = null;
  for (const w of [...sample.callWalls, ...sample.putWalls]) {
    if (!best || w.pct > best.pct) best = w;
  }
  return best?.strike ?? null;
}

/** Pct share of `strike` on the opposing side of one sample; 0 when the strike has
 *  dropped out of the sample's ladder (a dropped-out wall IS a faded wall). */
function opposingPctAt(sample: CortexWallTrendSample, direction: "long" | "short", strike: number): number {
  const side = direction === "long" ? sample.callWalls : sample.putWalls;
  return side.find((w) => w.strike === strike)?.pct ?? 0;
}

export function deriveWallTrendEvidence(input: CortexInputs): EvidenceItem[] {
  const { wallTrend, direction } = input;
  if (!wallTrend) return [absentForMissingSlice("wall-trend", input, "no wall-history rail")];

  const nowMs = parseMs(input.now);
  if (nowMs == null) return [absentForMissingSlice("wall-trend", input, "invalid now timestamp")];
  const windowStartSec = nowMs / 1000 - TREND_WINDOW_SEC;
  const samples = [...wallTrend.samples]
    .filter((s) => Number.isFinite(s.time) && s.time >= windowStartSec)
    .sort((a, b) => a.time - b.time);

  if (samples.length < MIN_TREND_SAMPLES) {
    // Recorder-gap honesty (design §1): below the floor the trend is unknowable.
    return [
      absentForMissingSlice(
        "wall-trend",
        input,
        `fewer than ${MIN_TREND_SAMPLES} rail samples in the ${TREND_WINDOW_SEC / 60}-min trend window`
      ),
    ];
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  // Evidence freshness = the LAST rail sample, not fetch time: if the recorder
  // stalled 40 min ago, this evidence is 40 min old and decays accordingly.
  const asOf = new Date(last.time * 1000).toISOString();
  const base = { source: "wall-trend" as const, halfLifeSec: WALL_TREND_HALF_LIFE_SEC, asOf };
  const items: EvidenceItem[] = [];

  // --- Opposing-wall strength slope -----------------------------------------
  // The wall in the play's way is the dominant opposing wall as of the freshest
  // sample; its pct share is then traced BACK through the window (0 when it wasn't
  // in the ladder yet / dropped out).
  const opposingSideWalls = direction === "long" ? last.callWalls : last.putWalls;
  const opposingWall = opposingSideWalls[0] ?? null;
  const opposingSideName = direction === "long" ? "call" : "put";

  if (opposingWall) {
    const points = samples.map((s) => ({
      timeSec: s.time,
      pct: opposingPctAt(s, direction, opposingWall.strike),
    }));
    const slope = railSlopePctPerHour(points);
    const startPct = points[0].pct;
    const endPct = points[points.length - 1].pct;
    const windowMin = (last.time - first.time) / 60;

    if (slope != null && Math.abs(slope) >= TREND_SLOPE_MIN_PCT_PTS_PER_HOUR) {
      const fading = slope < 0;
      items.push({
        ...base,
        stance: fading ? "supports" : "opposes",
        weight: WALL_TREND_WEIGHT,
        detail:
          `opposing ${opposingSideName} wall ${fmtNum(opposingWall.strike)} is ${fading ? "fading" : "building"}: ` +
          `ladder share ${fmtNum(startPct)}% -> ${fmtNum(endPct)}% over ${fmtNum(windowMin)} min ` +
          `(${fmtNum(slope)} pct-pts/hr) — path ${fading ? "clearing" : "hardening"}.`,
      });
    } else {
      items.push({
        ...base,
        stance: "supports",
        weight: 0,
        detail:
          `opposing ${opposingSideName} wall ${fmtNum(opposingWall.strike)} is flat over the window ` +
          `(share ${fmtNum(startPct)}% -> ${fmtNum(endPct)}%) — no lifecycle edge either way.`,
      });
    }
  }

  // --- King-node migration ----------------------------------------------------
  const kingStart = kingStrikeOfSample(first);
  const kingEnd = kingStrikeOfSample(last);
  if (kingStart != null && kingEnd != null && kingEnd !== kingStart) {
    const towardTarget = direction === "long" ? kingEnd > kingStart : kingEnd < kingStart;
    items.push({
      ...base,
      stance: towardTarget ? "supports" : "opposes",
      weight: KING_MIGRATION_WEIGHT,
      detail:
        `king node migrated ${fmtNum(kingStart)} -> ${fmtNum(kingEnd)} ` +
        `(${fmtNum(Math.abs(kingEnd - kingStart))} pts ${towardTarget ? "toward" : "away from"} the ${direction} target) — ` +
        `dealer-intent vector ${towardTarget ? "agrees" : "disagrees"}.`,
    });
  }

  if (items.length === 0) {
    // A rail with samples but no opposing wall at all (one-sided thin ladder) —
    // honest-gap: nothing to trend against.
    return [absentForMissingSlice("wall-trend", input, `no ${opposingSideName} wall on the rail to trend against`)];
  }
  return items;
}
