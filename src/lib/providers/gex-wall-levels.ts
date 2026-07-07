import { strikeTotalsFromLadder, wallsFromStrikeTotals } from "@/lib/providers/gex-cross-validation-core";

/** One gamma-wall level for the Vector chart overlay: the strike plus its share of concentration. */
export type GexWallLevel = { strike: number; pct: number };

export type GexWalls = {
  /** Largest-positive net-gamma strike (resistance) — same semantics as gex-positioning.ts's call_wall. */
  callWall: GexWallLevel | null;
  /** Largest-negative net-gamma strike (support) — same semantics as gex-positioning.ts's put_wall. */
  putWall: GexWallLevel | null;
};

/**
 * Put/call gamma-wall levels for the Vector chart overlay, sized by each wall's share of total
 * |gamma| across the ladder. Reuses wallsFromStrikeTotals() (the same largest-positive /
 * largest-negative strike picker already used for UW cross-validation) so the Vector chart's
 * walls can never diverge from the Thermal/Grid GEX panels reading the same underlying ladder.
 */
export function computeGexWalls(ladder: Map<number, number>): GexWalls {
  if (ladder.size === 0) return { callWall: null, putWall: null };

  const strikeTotals = strikeTotalsFromLadder(ladder);
  const { callWall, putWall } = wallsFromStrikeTotals(strikeTotals);

  let totalAbsGamma = 0;
  for (const g of Object.values(strikeTotals)) totalAbsGamma += Math.abs(g);
  if (totalAbsGamma <= 0) return { callWall: null, putWall: null };

  return {
    callWall:
      callWall != null
        ? { strike: callWall, pct: (Math.abs(strikeTotals[String(callWall)]) / totalAbsGamma) * 100 }
        : null,
    putWall:
      putWall != null
        ? { strike: putWall, pct: (Math.abs(strikeTotals[String(putWall)]) / totalAbsGamma) * 100 }
        : null,
  };
}

/**
 * Convert a `{strike: netGex}` record (e.g. GexHeatmap.gex.strike_totals, already scoped
 * server-side to the near-term expiries — see fetchGexHeatmap) into the Map shape
 * computeGexWalls() expects, so the same wall-picking/sizing logic can run over either the
 * live WS ladder or this REST-backed fallback.
 */
export function mapFromStrikeTotalsRecord(record: Record<string, number>): Map<number, number> {
  const map = new Map<number, number>();
  for (const [key, value] of Object.entries(record)) {
    const strike = Number(key);
    if (Number.isFinite(strike) && Number.isFinite(value)) map.set(strike, value);
  }
  return map;
}

/** Scope state for the live gamma-wall ladder: which near-term expiries to sum, and when that was last decided. */
export type WallScopeState = { expiries: string[] | undefined; fetchedAt: number };

/**
 * Decide the next near-term-expiry scope after a `fetchGexHeatmap("SPX")` attempt.
 *
 * A Polygon miss doesn't always reject — a transient spot-resolution failure or a 0-contract
 * chain read resolves to `emptyHeatmap()`, which has NO `near_term_expiries` field at all. If
 * that `undefined` were written straight into the scope, the very next ladder read would sum
 * every expiry UW has ever pushed instead of just the near-term set — reintroducing the exact
 * "hundreds of points of divergence for SPX" bug gex-cross-validation.ts's ladder scoping exists
 * to prevent (a transient/empty fetch is much more common than a rare edge case: it is UW's
 * feed cooling down for any reason, not just a hard outage). So a fetch only ADVANCES the scope
 * when it actually yields expiries; a thrown error (`fetchResult: null`) or an empty result keeps
 * the previous — possibly still-valid — scope, while still bumping `fetchedAt` so the caller
 * doesn't hot-retry on every tick.
 */
export function nextWallScope(
  prev: WallScopeState,
  now: number,
  fetchResult: { near_term_expiries?: string[] } | null
): WallScopeState {
  const expiries = fetchResult?.near_term_expiries?.length ? fetchResult.near_term_expiries : prev.expiries;
  return { expiries, fetchedAt: now };
}
