// OVERNIGHT CORTEX SOURCE: wall-migration — riding vs FIGHTING dealer structure.
//
// Forensic basis (NIGHTHAWK-OVERNIGHT-DECISION.md §3.2): the picker ignores per-ticker
// wall structure. "An overnight LONG whose target sits beyond a hardening call wall on
// the ticker's own ladder is fighting dealer structure." Two signals, in order of
// strength:
//   1. PATH check (always available from positioning): does the play's TARGET sit
//      beyond the dominant OPPOSING wall (call wall for a long, put wall for a short)?
//      If so the path to target runs THROUGH a dealer wall — an oppose.
//   2. MIGRATION check (only when the wall-history recorder persisted a rail): is that
//      opposing wall BUILDING (share of ladder |gamma| rising) across the session's
//      samples? A trade that must fight a HARDENING opposing wall is the §3.2 veto
//      case; a FADING opposing wall clears the path (support). Below the sample floor
//      this half is ABSENT (recorder-gap honesty — never guessed), and the path check
//      alone still speaks.

import type { OvernightInputs, OvernightWallSample, OvernightEvidenceItem } from "../types";
import { absentForMissingSlice, fmtNum } from "./shared";

/** Oppose weight when the target sits beyond the dominant opposing wall (path blocked). */
export const WALL_PATH_OPPOSE_WEIGHT = 1.0;

/** Support weight when the target is SHORT of the opposing wall (clear path). Capped
 *  small: a clear path is the baseline, not an edge. */
export const WALL_PATH_SUPPORT_WEIGHT = 0.5;

/** Per-source support cap. */
export const WALL_MIGRATION_SUPPORT_CAP = 0.6;

/** Extra oppose stacked on the path-block when the opposing wall is BUILDING — a
 *  hardening wall in the play's way. Path-block (1.0) + building (0.6) = 1.6, the
 *  heaviest single oppose on the overnight board (below the 3.0 veto). */
export const WALL_BUILDING_OPPOSE_WEIGHT = 0.6;

/** Support when the opposing wall is FADING — dealer structure yielding the path. */
export const WALL_FADING_SUPPORT_WEIGHT = 0.5;

/** Minimum rail samples before the migration half may speak (recorder-gap floor). */
export const MIN_WALL_SAMPLES = 4;

/** Slope floor in pct-points of ladder share per session-day, below which the opposing
 *  wall is "flat", not building/fading. */
export const WALL_SLOPE_MIN_PCT = 2;

/** Least-squares slope of (timeSec, pct) in pct-points per DAY (86400s). Exported for
 *  the migration unit test. null when <2 usable points or degenerate. */
export function wallSlopePctPerDay(samples: OvernightWallSample[]): number | null {
  const pts = samples
    .filter((s) => Number.isFinite(s.time) && s.opposingWallPct != null && Number.isFinite(s.opposingWallPct))
    .map((s) => ({ x: s.time, y: s.opposingWallPct as number }))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 2) return null;
  const n = pts.length;
  const t0 = pts[0].x;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of pts) {
    const x = (p.x - t0) / 86_400; // days from first sample
    sx += x; sy += p.y; sxy += x * p.y; sxx += x * x;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return (n * sxy - sx * sy) / denom;
}

export function deriveWallMigrationEvidence(input: OvernightInputs): OvernightEvidenceItem[] {
  const { wall, direction } = input;
  if (!wall) return [absentForMissingSlice("wall-migration", input, "no GEX wall structure for the ticker")];
  if (wall.opposingWall == null || wall.target == null) {
    return [absentForMissingSlice("wall-migration", input, "no opposing wall / target to measure the path against")];
  }

  const items: OvernightEvidenceItem[] = [];
  const oppSide = direction === "long" ? "call" : "put";
  const wallStrike = wall.opposingWall.strike;
  const target = wall.target;
  // Spot is narrative-only (the path check is target-vs-wall); render "n/a" if absent.
  const spotStr = wall.spot != null ? fmtNum(wall.spot) : "n/a";

  // --- Path check ------------------------------------------------------------
  // LONG: target above the call wall ⇒ path runs through resistance (blocked).
  // SHORT: target below the put wall ⇒ path runs through support (blocked).
  const pathBlocked = direction === "long" ? target > wallStrike : target < wallStrike;

  // --- Migration check (only with a real rail) -------------------------------
  const slope = wall.samples.length >= MIN_WALL_SAMPLES ? wallSlopePctPerDay(wall.samples) : null;
  const migrationKnown = slope != null && Math.abs(slope) >= WALL_SLOPE_MIN_PCT;
  const building = migrationKnown && (slope as number) > 0;
  const fading = migrationKnown && (slope as number) < 0;
  const migrationNote =
    slope == null
      ? "wall-history rail too sparse to judge migration"
      : migrationKnown
        ? `${oppSide} wall ${building ? "building" : "fading"} ${fmtNum(Math.abs(slope as number))} pct-pts/day`
        : `${oppSide} wall strength flat (${fmtNum(slope as number)} pct-pts/day)`;

  if (pathBlocked) {
    items.push({
      source: "wall-migration",
      stance: "opposes",
      weight: WALL_PATH_OPPOSE_WEIGHT,
      asOf: wall.asOf,
      detail:
        `${direction} target ${fmtNum(target)} sits beyond the dominant ${oppSide} wall ${fmtNum(wallStrike)} ` +
        `(spot ${spotStr}) — path to target runs through dealer structure; ${migrationNote}.`,
    });
    if (building) {
      items.push({
        source: "wall-migration",
        stance: "opposes",
        weight: WALL_BUILDING_OPPOSE_WEIGHT,
        asOf: wall.asOf,
        detail:
          `and that ${oppSide} wall ${fmtNum(wallStrike)} is HARDENING (${fmtNum(slope as number)} pct-pts/day over ${wall.samples.length} samples) — ` +
          `fighting a building opposing wall (§3.2).`,
      });
    }
  } else {
    // Clear path — the opposing wall is not between spot and target.
    items.push({
      source: "wall-migration",
      stance: "supports",
      weight: fading ? WALL_FADING_SUPPORT_WEIGHT : WALL_PATH_SUPPORT_WEIGHT,
      asOf: wall.asOf,
      detail:
        `${direction} target ${fmtNum(target)} is short of the dominant ${oppSide} wall ${fmtNum(wallStrike)} ` +
        `(spot ${spotStr}) — clear path; ${migrationNote}.`,
    });
  }

  return items;
}
