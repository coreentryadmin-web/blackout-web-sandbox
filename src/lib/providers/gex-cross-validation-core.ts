import { zeroGammaFlip } from "@/lib/providers/gex-intraday-adjust-core";

/**
 * The UW REST fallback (`/spot-exposures/strike`) sums every expiry server-side with no
 * per-expiry field to filter on — it structurally cannot be scoped to match Polygon's
 * near-term-only walls (verified live 2026-07-01 against the real UW API: the sibling
 * `/spot-exposures/expiry-strike` endpoint DOES carry a per-row expiry, but its
 * `expirations[]` filter only honors one value even when several are passed, and
 * unfiltered it caps at 50 rows that don't reliably cover the needed strike band). When
 * the caller requires scoping, running the REST fallback anyway would compare mismatched
 * universes and produce a guaranteed false-positive divergence — worse than skipping the
 * check. See `gex-cross-validation.ts`'s module-level SCOPE doc for the full write-up.
 */
export function restFallbackAllowed(nearTermExpiries: readonly string[] | undefined): boolean {
  return !(nearTermExpiries && nearTermExpiries.length > 0);
}

/**
 * Scope a GexHeatmap-shaped object's expiries down to the near-term-only set that
 * `call_wall`/`put_wall`/`flip` are actually computed from, for passing to
 * `validateGexAgainstUW`. Prefer the authoritative `near_term_expiries` field (the
 * pre-far-merge set the engine captured before far-dated monthly/quarterly columns were
 * added — see `resolveExpiryAxis()` in polygon-options-gex.ts). `expiries.slice(0, N)`
 * LOOKS equivalent but is not: on a ticker whose real near-term (daily/weekly) expiry
 * count is below N, the post-merge sorted `expiries` array silently pads the slice with
 * far-dated columns (they sort right after the real near dates) — reintroducing the exact
 * bug class `resolveExpiryAxis()` was built to prevent for max_pain/GEX/VEX/DEX/CHARM. For
 * any non-SPX/SPY/QQQ single-name ticker (most only have weekly+monthly options, no daily
 * 0DTE), that's the common case, not an edge case. Falls back to the slice only for legacy
 * cached heatmaps predating the `near_term_expiries` field.
 */
export function resolveNearTermExpiriesForCrossValidation(
  hm: { near_term_expiries?: string[]; expiries?: string[] } | null | undefined,
  legacySliceCount = 8
): string[] | undefined {
  if (hm?.near_term_expiries?.length) return hm.near_term_expiries;
  return hm?.expiries?.slice(0, legacySliceCount);
}

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
