import { zeroGammaFlip } from "@/lib/providers/gex-intraday-adjust-core";

/** Largest-positive (call) and largest-negative (put) wall strikes from per-strike totals. */
export function wallsFromStrikeTotals(strikeTotals: Record<string, number>): {
  callWall: number | null;
  putWall: number | null;
} {
  let callWall: number | null = null;
  let putWall: number | null = null;
  let maxPos = 0;
  let maxNeg = 0;
  for (const [s, gRaw] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    const g = Number(gRaw);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    if (g > maxPos) {
      maxPos = g;
      callWall = strike;
    }
    if (g < maxNeg) {
      maxNeg = g;
      putWall = strike;
    }
  }
  return { callWall, putWall };
}

export function strikeTotalsFromLadder(ladder: Map<number, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [strike, g] of ladder) {
    if (Number.isFinite(strike) && Number.isFinite(g)) out[String(strike)] = g;
  }
  return out;
}

/** UW oracle levels derived with the same sign semantics as polygon computeGexRegime. */
export function uwLevelsFromLadder(
  ladder: Map<number, number>,
  spot = 0
): { callWall: number | null; putWall: number | null; gammaFlip: number | null } {
  const strikeTotals = strikeTotalsFromLadder(ladder);
  const { callWall, putWall } = wallsFromStrikeTotals(strikeTotals);
  const gammaFlip = zeroGammaFlip(strikeTotals, spot);
  return { callWall, putWall, gammaFlip };
}

export type GexCrossValidationCoreResult = {
  callWallMatch: boolean;
  putWallMatch: boolean;
  flipMatch: boolean;
  divergence: number | null;
  uw: { callWall: number | null; putWall: number | null; gammaFlip: number | null };
};

const DEFAULT_STRIKE_TOLERANCE = 2;

function levelMatch(
  primary: number | null,
  oracle: number | null,
  tolerance: number
): { match: boolean; minDist: number | null } {
  if (primary == null || !Number.isFinite(primary)) return { match: false, minDist: null };
  if (oracle == null || !Number.isFinite(oracle)) return { match: false, minDist: null };
  const minDist = Math.abs(primary - oracle);
  return { match: minDist <= tolerance, minDist };
}

/**
 * Sign-aware cross-validation: compare primary call/put/flip to UW levels computed with
 * the same extrema + zero-crossing rules as the Polygon pipeline — NOT top-|GEX| strikes.
 */
export function crossValidateGexLevels(
  primary: { callWall: number | null; putWall: number | null; gammaFlip: number | null },
  ladder: Map<number, number>,
  opts?: { spot?: number; strikeTolerance?: number }
): GexCrossValidationCoreResult | null {
  if (!ladder || ladder.size === 0) return null;

  const tolerance = opts?.strikeTolerance ?? DEFAULT_STRIKE_TOLERANCE;
  const uw = uwLevelsFromLadder(ladder, opts?.spot ?? 0);

  const callResult = levelMatch(primary.callWall, uw.callWall, tolerance);
  const putResult = levelMatch(primary.putWall, uw.putWall, tolerance);
  const flipResult = levelMatch(primary.gammaFlip, uw.gammaFlip, tolerance);

  const dists = [callResult.minDist, putResult.minDist, flipResult.minDist].filter(
    (d): d is number => d != null
  );
  const divergence = dists.length > 0 ? Math.max(...dists) : null;

  return {
    callWallMatch: callResult.match,
    putWallMatch: putResult.match,
    flipMatch: flipResult.match,
    divergence,
    uw,
  };
}
