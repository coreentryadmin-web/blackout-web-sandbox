/** 0DTE gamma desk — flip level & GEX walls (ported from engine gamma_desk.py). */

export type GexStrikeLevel = {
  strike: number;
  net_gex: number;
  call_gex: number;
  put_gex: number;
};

export type GexWall = {
  strike: number;
  net_gex: number;
  kind: "support" | "resistance";
  distance_pts: number;
};

export function analyzeStrikeGexRows(rows: Record<string, unknown>[]): {
  net_gex: number;
  gex_king_strike: number | null;
  ranked_levels: GexStrikeLevel[];
} {
  const levels: GexStrikeLevel[] = [];
  let totalCall = 0;
  let totalPut = 0;

  for (const row of rows) {
    const strike = Number(row.strike);
    if (!Number.isFinite(strike)) continue;
    const callG = Number(row.call_gamma_oi ?? row.call_gex ?? 0);
    const putG = Number(row.put_gamma_oi ?? row.put_gex ?? 0);
    if (!Number.isFinite(callG) || !Number.isFinite(putG)) continue;
    const net = callG + putG;
    // Drop ONLY genuinely empty (0/0) strikes. Since net = callG + putG, the test
    // (callG === 0 && putG === 0) already implies net === 0, so the old `net === 0 &&`
    // clause was redundant. A balanced strike (callG = -putG, net = 0) deliberately
    // SURVIVES: it adds 0 to computeGammaFlip's cumulative sum (output-neutral), so it
    // never distorts the flip. Do NOT change this to `if (net === 0) continue;` — that
    // would delete real balanced strikes and shift flip anchoring.
    if (callG === 0 && putG === 0) continue;
    totalCall += callG;
    totalPut += putG;
    levels.push({ strike, net_gex: net, call_gex: callG, put_gex: putG });
  }

  const ranked = [...levels].sort((a, b) => Math.abs(b.net_gex) - Math.abs(a.net_gex));
  const king = ranked[0]?.strike ?? null;

  return {
    net_gex: totalCall + totalPut,
    gex_king_strike: king,
    ranked_levels: ranked,
  };
}

export function computeGammaFlip(
  levels: Array<{ strike: number; net_gex: number }>,
  spot: number
): number | null {
  if (!levels.length || spot <= 0) return null;

  const sorted = [...levels].sort((a, b) => a.strike - b.strike);
  let cum = 0;
  let prevStrike: number | null = null;
  let prevCum = 0;
  let bestFlip: number | null = null;
  let bestDist = Infinity;
  // P3 fix: a flip requires the cumulative GEX to actually CHANGE SIGN, not merely
  // touch zero. The old prevCum===0 / newCum===0 branches fired on any zero touch,
  // so a "tangent" profile (e.g. cum +10 -> 0 -> +10) registered a flip that could be
  // arbitrarily far from spot and win on distance. We defer a zero-touch and only
  // confirm it when the next non-zero cumulative has the OPPOSITE sign (a true
  // crossing), or when it is the terminal touch away from a non-zero side.
  let lastNonZeroSign = 0;
  let pendingZeroStrike: number | null = null;
  let pendingSignBefore = 0;

  const considerFlip = (flip: number, exact: boolean) => {
    const dist = Math.abs(spot - flip);
    if (dist < bestDist) {
      bestDist = dist;
      bestFlip = exact ? flip : Math.round(flip * 100) / 100;
    }
  };

  for (const lv of sorted) {
    const strike = lv.strike;
    const net = lv.net_gex;
    const newCum = cum + net;
    const newSign = newCum > 0 ? 1 : newCum < 0 ? -1 : 0;

    // Genuine sign change between two non-zero cumulatives -> interpolate (unchanged).
    if (prevStrike != null && prevCum !== 0 && newCum !== 0 && prevCum * newCum < 0) {
      const denom = Math.abs(prevCum) + Math.abs(newCum);
      const frac = denom > 0 ? Math.abs(prevCum) / denom : 0.5;
      considerFlip(prevStrike + frac * (strike - prevStrike), false);
    }

    if (newSign !== 0) {
      if (pendingZeroStrike != null) {
        // Confirm the deferred zero touch only if it was a real crossing: the sign
        // before the zero differs from the sign after (or the cumulative began at 0).
        if (pendingSignBefore === 0 || pendingSignBefore !== newSign) {
          considerFlip(pendingZeroStrike, true);
        }
        pendingZeroStrike = null;
      }
      lastNonZeroSign = newSign;
    } else if (prevStrike != null && pendingZeroStrike == null) {
      // Cumulative hit exactly zero -> defer until the next non-zero sign resolves it.
      pendingZeroStrike = strike;
      pendingSignBefore = lastNonZeroSign;
    }

    cum = newCum;
    prevStrike = strike;
    prevCum = newCum;
  }

  // Terminal zero touch: reaching zero from a non-zero side at the end of the chain
  // is the boundary of the gamma profile, so it is the flip (e.g. cum +10 -> 0).
  if (pendingZeroStrike != null && pendingSignBefore !== 0) {
    considerFlip(pendingZeroStrike, true);
  }

  return bestFlip;
}

export function gammaRegime(spot: number, flip: number | null): string {
  if (flip == null) return "unknown";
  return spot > flip ? "mean_revert" : "amplification";
}

/**
 * Debounce flip churn — require spot to clear flip by bufferPts before regime changes.
 *
 * Net-GEX tie-break (coherence fix): the ±bufferPts band around the flip is exactly where a raw
 * spot-vs-flip read is least trustworthy — a hair either side flips the label, and the sticky
 * hysteresis can hold a STALE regime that contradicts the actual dealer positioning. Inside that band
 * the SIGN OF NET GEX is authoritative (positive net = dealers net LONG gamma → they fade/pin →
 * mean_revert; negative = net SHORT → they chase → amplification). This is what a live RTH scan
 * caught: at spot≈flip the desk served "amplification" while netGex was +20.7B (long gamma) and the
 * walls pinned long-gamma. Outside the band, spot-vs-flip is unambiguous and hysteresis is unchanged.
 * `netGex` is optional so every existing caller (and the null-net case) keeps the prior behavior.
 */
export function gammaRegimeWithHysteresis(
  spot: number,
  flip: number | null,
  previous: string,
  bufferPts = 2,
  netGex?: number | null
): string {
  const raw = gammaRegime(spot, flip);
  if (flip == null || raw === "unknown") return raw;
  // Inside the ambiguous ±buffer band, break the tie with the net-GEX sign when we know it — the
  // desk's own dealer-positioning number wins over a knife-edge spot-vs-flip read or a sticky prior.
  if (netGex != null && Number.isFinite(netGex) && Math.abs(spot - flip) < bufferPts) {
    return netGex >= 0 ? "mean_revert" : "amplification";
  }
  if (previous === "unknown") return raw;
  if (previous === raw) return raw;
  if (previous === "mean_revert" && raw === "amplification") {
    return spot <= flip - bufferPts ? "amplification" : "mean_revert";
  }
  if (previous === "amplification" && raw === "mean_revert") {
    return spot >= flip + bufferPts ? "mean_revert" : "amplification";
  }
  return raw;
}

/**
 * Build the GEX-wall ladder shown on the SPX desk.
 *
 * BALANCED, TWO-SIDED selection (fix for the put-only ladder, bug #93): the panel must
 * always surface BOTH the upside CALL wall and the downside PUT wall, anchored to spot —
 * not just the biggest-magnitude strikes, which on a negative-gamma day are all puts and
 * left the call wall dropped entirely.
 *
 * Wall semantics match the canonical Heatmap (`computeGexRegime` in polygon-options-gex.ts)
 * so "Call Wall"/"Put Wall" mean the SAME strike everywhere (cross-tool consistency, #80):
 *   - #1 Call Wall  = strike with the LARGEST POSITIVE net_gex (dealer long-gamma → resistance/magnet)
 *   - #1 Put Wall   = strike with the LARGEST NEGATIVE net_gex (support)
 * These two anchors are GUARANTEED in the output whenever they exist in the live chain.
 *
 * `kind` stays GEOMETRIC (strike > spot → "resistance", else "support"), preserving the
 * GexWall contract the verdict engine + recalcGexWallDistances assume. The component derives
 * the "call/put wall" label from net_gex SIGN and notes the acting-as role when spot has
 * already traded through a wall (geometry ≠ sign).
 *
 * GROUNDED: every wall is a REAL strike from the chain. If the chain genuinely has no
 * positive-net_gex strike anywhere, NO call wall is invented — the ladder is honestly
 * put-only (the component surfaces a "fully put-dominated" note).
 */
export function topGexWalls(levels: GexStrikeLevel[], spot: number, limit = 6): GexWall[] {
  if (!levels.length || spot <= 0) return [];

  const mkWall = (lv: GexStrikeLevel): GexWall => ({
    strike: lv.strike,
    net_gex: lv.net_gex,
    // Geometric kind (see contract note above) — NOT net_gex sign.
    kind: lv.strike > spot ? "resistance" : "support",
    distance_pts: Math.round((lv.strike - spot) * 100) / 100,
  });

  // Canonical extrema across the WHOLE chain (mirrors heatmap computeGexRegime): the largest
  // positive net-gamma strike is the call wall, the largest negative is the put wall. These
  // are the guaranteed anchors and are picked by SIGN, never by proximity, so they survive a
  // one-sided-by-magnitude day.
  let callWall: GexStrikeLevel | null = null; // max positive net_gex
  let putWall: GexStrikeLevel | null = null; // max negative net_gex (most negative)
  for (const lv of levels) {
    if (!Number.isFinite(lv.net_gex)) continue;
    if (lv.net_gex > 0 && (callWall === null || lv.net_gex > callWall.net_gex)) callWall = lv;
    if (lv.net_gex < 0 && (putWall === null || lv.net_gex < putWall.net_gex)) putWall = lv;
  }

  // Secondary fill: walk OUT from spot on each side and take the nearest real strikes, so the
  // ladder reads as a balanced spot-anchored map (calls above, puts below). Magnitude breaks
  // proximity ties so the more significant node wins at equal distance.
  const half = Math.max(1, Math.ceil(limit / 2));
  const above = levels
    .filter((l) => l.strike > spot)
    .sort((a, b) => a.strike - b.strike || Math.abs(b.net_gex) - Math.abs(a.net_gex));
  const below = levels
    .filter((l) => l.strike <= spot)
    .sort((a, b) => b.strike - a.strike || Math.abs(b.net_gex) - Math.abs(a.net_gex));

  const picked = new Map<number, GexStrikeLevel>();
  const add = (lv: GexStrikeLevel | null | undefined) => {
    if (lv && !picked.has(lv.strike)) picked.set(lv.strike, lv);
  };

  // Guaranteed anchors first so they're never crowded out by the proximity fill.
  add(callWall);
  add(putWall);

  // Then fill ~half a side from each side, nearest-to-spot first, until the limit is reached.
  let ai = 0;
  let bi = 0;
  let callCount = callWall && callWall.strike > spot ? 1 : 0;
  let putCount = putWall && putWall.strike <= spot ? 1 : 0;
  while (picked.size < limit && (ai < above.length || bi < below.length)) {
    if (ai < above.length && (callCount < half || bi >= below.length)) {
      const lv = above[ai++];
      if (!picked.has(lv.strike)) {
        picked.set(lv.strike, lv);
        callCount++;
      }
    } else if (bi < below.length) {
      const lv = below[bi++];
      if (!picked.has(lv.strike)) {
        picked.set(lv.strike, lv);
        putCount++;
      }
    } else {
      break;
    }
  }
  void putCount;

  if (picked.size > limit) {
    const ranked = [...picked.values()].sort(
      (a, b) => Math.abs(b.net_gex) - Math.abs(a.net_gex)
    );
    picked.clear();
    for (const lv of ranked.slice(0, limit)) picked.set(lv.strike, lv);
  }

  // Descending by strike → calls render above the spot anchor, puts below.
  return [...picked.values()].map(mkWall).sort((a, b) => b.strike - a.strike);
}
