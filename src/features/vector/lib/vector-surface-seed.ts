/**
 * ONE canonical derivation of the SSR-seeded Vector surface state (N5-1 "one-flip-source").
 *
 * The page banner (regime), the desk-terminal proximity/magnet callouts, and the wall-integrity
 * badges are all first painted from the SAME server snapshot — one spot, one gamma flip, one wall
 * set. Before this helper, VectorPageShell seeded each of them with its OWN inline
 * `deriveVectorRegime({ gammaFlip: initialGammaFlip, ... })` call (regime once for the banner, and
 * AGAIN inside the magnet seed to get its posture) — the exact "flip/regime sourced from >1 place"
 * drift the audit flagged: two derivations from the same inputs are one refactor away from
 * silently disagreeing (a changed default, a reordered wall, a stale copy). Routing every seeded
 * surface through this single function makes that structurally impossible — the flip enters once,
 * the regime is derived once, and its posture feeds the magnet, so the three surfaces cannot
 * describe different regimes on first paint.
 *
 * Pure and dependency-light (composes the existing pure derive fns) so it stays unit-testable and
 * SSR-safe. The LIVE cadence coherence (chart/ladder/terminal reading one atomic per-15s snapshot)
 * is a separate, larger piece tracked in FINDINGS — this closes the seed-time half.
 */

import type { VectorWalls } from "@/lib/api";
import { deriveVectorRegime, type VectorRegime } from "./vector-regime";
import { deriveWallProximity, type WallProximity } from "./vector-wall-proximity";
import { deriveGammaMagnet, type GammaMagnet } from "./vector-gamma-magnet";
import { scoreTopWalls, type WallIntegrity } from "./vector-wall-integrity";
import type { WallHistorySample } from "./vector-wall-history";

export type VectorSurfaceSeed = {
  regime: VectorRegime;
  proximity: WallProximity | null;
  magnet: GammaMagnet | null;
  wallIntegrity: { call: WallIntegrity | null; put: WallIntegrity | null };
};

/**
 * Derive the full seed-time surface state from ONE snapshot. `spot`, `gammaFlip`, and `walls` are
 * the canonical inputs; the regime is derived a SINGLE time and its posture is threaded into the
 * gamma magnet so the banner and the terminal can never seed with different regimes.
 */
export function deriveVectorSurfaceSeed(input: {
  spot: number | null;
  gammaFlip: number | null;
  walls: VectorWalls | null;
  wallHistory?: readonly WallHistorySample[];
}): VectorSurfaceSeed {
  const { spot, gammaFlip, walls } = input;
  const topCallWall = walls?.callWalls?.[0]?.strike ?? null;
  const topPutWall = walls?.putWalls?.[0]?.strike ?? null;

  // The one flip → regime derivation every seeded surface shares.
  const regime = deriveVectorRegime({ spot, gammaFlip, topCallWall, topPutWall });

  return {
    regime,
    proximity: deriveWallProximity({ spot, walls, gammaFlip }),
    // Posture comes from the SAME regime object above — not a second deriveVectorRegime call.
    magnet: deriveGammaMagnet({ spot, walls, posture: regime.posture }),
    wallIntegrity: scoreTopWalls(walls, input.wallHistory ?? []),
  };
}
