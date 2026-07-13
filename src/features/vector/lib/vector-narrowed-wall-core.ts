// Pure core for narrowed-horizon (0dte/weekly/monthly) wall recording — the fix for the
// "frozen 0DTE rail" bug. Kept free of `server-only`/network imports so the decision logic is
// unit-testable. The server orchestration (fetching per-horizon walls) lives in vector-snapshot.ts's
// `buildNarrowedHorizonWallSamples`, which calls `pickNarrowedWallSample` below.
//
// Root cause it addresses: narrowed rails were written ONLY by the 5-min universe cron, and that
// writer DROPPED the bucket whenever a horizon's per-expiry (SPXW) reconstruction returned empty —
// so the SPX 0DTE rail advanced ~1/25min and looked frozen. Both the live 15s hub and the cron now
// share this core. (The blended fallback that used to live here is gone — see pickNarrowedWallSample.)
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
 * - else nothing to record ("empty") — an HONEST GAP.
 *
 * The blended-near-term fallback was REMOVED (2026-07-13, member-caught). It recorded the blended
 * all-day-stable ladder INTO the narrowed rails whenever the per-expiry chain was empty — which for
 * single names on non-expiry days (e.g. TSLA on a Monday: no 0DTE chain exists) meant the ENTIRE
 * "0DTE" rail was blended data mislabeled as 0DTE: full-width static trails, no births, no deaths,
 * immune to the dominance filter because the underlying set never changed. "Keeps the rail
 * advancing" was the wrong goal — a rail of wrong-scope data is worse than an empty one. A member
 * must be able to trust that every bead on a narrowed lens was genuinely that horizon's structure.
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
  return { sample: null, source: "empty" };
}
