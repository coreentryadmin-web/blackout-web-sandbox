// Pure core for narrowed-horizon (0dte/weekly/monthly) wall recording — the fix for the
// "frozen 0DTE rail" bug. Kept free of `server-only`/network imports so the decision logic is
// unit-testable. The server orchestration (fetching per-horizon walls) lives in vector-snapshot.ts's
// `buildNarrowedHorizonWallSamples`, which calls `pickNarrowedWallSample` below.
//
// Root cause it addresses: narrowed rails were written ONLY by the 5-min universe cron, and that
// writer DROPPED the bucket whenever a horizon's per-expiry (SPXW) reconstruction returned empty —
// so the SPX 0DTE rail advanced ~1/25min and looked frozen. Both the live 15s hub and the cron now
// share this core, which FALLS BACK to the blended near-term walls (this bucket's fresh reading)
// when a horizon is momentarily empty, instead of dropping the bucket.

import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { VectorDteHorizon } from "./vector-dte-horizon";
import { buildWallHistorySample } from "./vector-wall-sample";
import type { WallHistorySample } from "./vector-wall-history";

/** Narrowed DTE horizons recorded alongside the blended "all" rail. */
export const RECORDED_WALL_HORIZONS: readonly VectorDteHorizon[] = ["0dte", "weekly", "monthly"];

export function hasWallNodes(w: GexWalls | null | undefined): boolean {
  return Boolean(w && (w.callWalls.length > 0 || w.putWalls.length > 0));
}

export type NarrowedWallSource = "horizon" | "blended-fallback" | "empty";

export type NarrowedWallOutcome = {
  horizon: VectorDteHorizon;
  sample: WallHistorySample | null;
  source: NarrowedWallSource | "error";
  reason?: string;
};

/**
 * Choose the wall sample for one narrowed horizon:
 * - horizon walls present → record them ("horizon").
 * - else blended near-term walls present → record those so the rail keeps advancing
 *   ("blended-fallback"). This is NOT a stale carry-forward: the blended walls are this bucket's
 *   real current reading, just not horizon-scoped — the documented fallback contract.
 * - else nothing to record ("empty") — an honest gap.
 */
export function pickNarrowedWallSample(input: {
  time: number;
  horizonWalls: GexWalls | null;
  horizonFlip: number | null;
  blendedWalls: GexWalls | null;
  blendedFlip: number | null;
}): { sample: WallHistorySample | null; source: NarrowedWallSource } {
  if (hasWallNodes(input.horizonWalls)) {
    return {
      sample: buildWallHistorySample({
        time: input.time,
        gexWalls: input.horizonWalls,
        gammaFlip: input.horizonFlip,
        vexWalls: null,
        vexFlip: null,
      }),
      source: "horizon",
    };
  }
  if (hasWallNodes(input.blendedWalls)) {
    return {
      sample: buildWallHistorySample({
        time: input.time,
        gexWalls: input.blendedWalls,
        gammaFlip: input.blendedFlip,
        vexWalls: null,
        vexFlip: null,
      }),
      source: "blended-fallback",
    };
  }
  return { sample: null, source: "empty" };
}
