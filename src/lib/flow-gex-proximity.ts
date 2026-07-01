export type GexProximityLabel =
  | "at_gamma_flip"
  | "at_call_wall"
  | "at_put_wall"
  | "near_call_wall"
  | "near_put_wall";

/** Within 0.5% of a level — covers roughly ±2 strikes for SPX/SPY/single-names. */
function isNear(strike: number, level: number | null): boolean {
  if (level == null || !Number.isFinite(level) || level === 0) return false;
  return Math.abs(strike - level) / level < 0.005;
}

/** Within 0.15% — "at" rather than merely "near". */
function isAt(strike: number, level: number | null): boolean {
  if (level == null || !Number.isFinite(level) || level === 0) return false;
  return Math.abs(strike - level) / level < 0.0015;
}

export function computeGexProximity(
  strike: number,
  flip: number | null,
  callWall: number | null,
  putWall: number | null
): GexProximityLabel | null {
  if (isAt(strike, flip)) return "at_gamma_flip";
  if (isAt(strike, callWall)) return "at_call_wall";
  if (isAt(strike, putWall)) return "at_put_wall";
  if (isNear(strike, callWall)) return "near_call_wall";
  if (isNear(strike, putWall)) return "near_put_wall";
  return null;
}

export type GexLevelSnapshot = {
  flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
};

export function enrichFlowWithGex<T extends { ticker: string; strike: number }>(
  flow: T,
  gex: GexLevelSnapshot
): T & { gex_proximity?: GexProximityLabel } {
  const proximity = computeGexProximity(flow.strike, gex.flip, gex.call_wall, gex.put_wall);
  if (!proximity) return flow;
  return { ...flow, gex_proximity: proximity };
}
