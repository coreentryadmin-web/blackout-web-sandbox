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

export function topGexWalls(levels: GexStrikeLevel[], spot: number, limit = 6): GexWall[] {
  if (!levels.length || spot <= 0) return [];

  const band = Math.max(spot * 0.012, 75);
  const near = levels.filter((l) => Math.abs(l.strike - spot) <= band);
  const pool =
    near.length >= 3
      ? near
      : [...levels]
          .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
          .slice(0, Math.max(limit * 4, 24));

  const above = pool
    .filter((l) => l.strike > spot)
    .sort((a, b) => a.strike - b.strike || Math.abs(b.net_gex) - Math.abs(a.net_gex));
  const below = pool
    .filter((l) => l.strike <= spot)
    .sort((a, b) => b.strike - a.strike || Math.abs(b.net_gex) - Math.abs(a.net_gex));

  const half = Math.ceil(limit / 2);
  const walls: GexWall[] = [];

  for (const lv of below.slice(0, half)) {
    walls.push({
      strike: lv.strike,
      net_gex: lv.net_gex,
      kind: "support",
      distance_pts: Math.round((lv.strike - spot) * 100) / 100,
    });
  }
  for (const lv of above.slice(0, half)) {
    walls.push({
      strike: lv.strike,
      net_gex: lv.net_gex,
      kind: "resistance",
      distance_pts: Math.round((lv.strike - spot) * 100) / 100,
    });
  }

  return walls.sort((a, b) => b.strike - a.strike);
}
