import { strikeTotalsFromLadder } from "@/lib/providers/gex-cross-validation-core";

/** One gamma-wall level for the Vector chart overlay: the strike plus its share of concentration. */
export type GexWallLevel = { strike: number; pct: number };

export type GexWalls = {
  /** Positive net-gamma strikes (resistance), ranked strongest-first. [0], when present, is the
   *  same strike gex-positioning.ts's call_wall would pick (largest-positive net-gamma strike) —
   *  see gex-wall-levels.test.ts's cross-check against wallsFromStrikeTotals(). */
  callWalls: GexWallLevel[];
  /** Negative net-gamma strikes (support), ranked strongest-first — same relationship to
   *  gex-positioning.ts's put_wall as callWalls[0] has to call_wall. */
  putWalls: GexWallLevel[];
};

/** Matches Skylit's own "NODES" concept — how many ranked levels to show per side by default. */
export const DEFAULT_WALL_NODES_PER_SIDE = 3;

/**
 * Put/call gamma-wall levels for the Vector chart overlay, sized by each wall's share of total
 * |gamma| across the ladder and ranked strongest-first, capped at `maxPerSide` per side (top-1
 * behavior is unchanged from before this was extended to multi-node: `callWalls[0]`/`putWalls[0]`
 * are the exact same largest-positive/largest-negative strikes gex-positioning.ts's
 * call_wall/put_wall would pick — same reason as before, so the Vector chart's #1 wall per side
 * can never diverge from the Thermal/Grid GEX panels reading the same underlying ladder).
 */
export function computeGexWalls(
  ladder: Map<number, number>,
  { maxPerSide = DEFAULT_WALL_NODES_PER_SIDE }: { maxPerSide?: number } = {}
): GexWalls {
  if (ladder.size === 0) return { callWalls: [], putWalls: [] };

  const strikeTotals = strikeTotalsFromLadder(ladder);

  let totalAbsGamma = 0;
  for (const g of Object.values(strikeTotals)) totalAbsGamma += Math.abs(g);
  if (totalAbsGamma <= 0) return { callWalls: [], putWalls: [] };

  const callWalls: GexWallLevel[] = [];
  const putWalls: GexWallLevel[] = [];
  for (const [strikeStr, g] of Object.entries(strikeTotals)) {
    const strike = Number(strikeStr);
    if (!Number.isFinite(strike) || !Number.isFinite(g) || g === 0) continue;
    const pct = (Math.abs(g) / totalAbsGamma) * 100;
    if (g > 0) callWalls.push({ strike, pct });
    else putWalls.push({ strike, pct });
  }
  callWalls.sort((a, b) => b.pct - a.pct);
  putWalls.sort((a, b) => b.pct - a.pct);

  return {
    callWalls: callWalls.slice(0, maxPerSide),
    putWalls: putWalls.slice(0, maxPerSide),
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
