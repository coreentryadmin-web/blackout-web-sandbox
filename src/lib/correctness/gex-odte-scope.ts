import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";
import {
  kingFromStrikeTotals,
  zeroGammaFlip as computeZeroGammaFlip,
} from "@/lib/providers/gex-cross-validation-core";

/**
 * Resolve the 0DTE expiry column from a heatmap's expiry axis.
 * Prefers today's ET date when present; otherwise the nearest front expiry.
 */
export function resolveOdteExpiry(expiries: string[], todayEt: string): string | null {
  if (expiries.length === 0) return null;
  return expiries.includes(todayEt) ? todayEt : expiries[0] ?? null;
}

/** Strict 0DTE: today's ET date only — no silent front-expiry fallback. */
export function resolveZeroDteExpiry(expiries: string[], todayEt: string): string | null {
  if (expiries.length === 0) return null;
  return expiries.includes(todayEt) ? todayEt : null;
}

/** Per-strike totals for one expiry column — includes explicit zeros on the axis. */
export function columnTotalsForAxis(
  cells: Record<string, Record<string, number>>,
  strikesAxis: number[],
  expiry: string | null
): Record<string, number> {
  if (!expiry || strikesAxis.length === 0) return {};
  const out: Record<string, number> = {};
  for (const strike of strikesAxis) {
    const v = cells[String(strike)]?.[expiry];
    out[String(strike)] = typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  return out;
}

/**
 * Per-strike net GEX for ONE expiry column — mirrors SpxOdteMatrixPanel's 0DTE slice.
 * Used to align the UW 0DTE oracle with like-for-like scope (not the near-term aggregate).
 */
export function odteStrikeTotalsFromCells(
  cells: Record<string, Record<string, number>>,
  strikes: number[],
  expiry: string | null
): Record<string, number> {
  if (!expiry || strikes.length === 0) return {};
  const out: Record<string, number> = {};
  for (const strike of strikes) {
    const v = cells[String(strike)]?.[expiry];
    if (typeof v === "number" && Number.isFinite(v) && v !== 0) {
      out[String(strike)] = v;
    }
  }
  return out;
}

/** 0DTE-scoped strike totals + net from a served heatmap snapshot. */
export function odteGexScopeFromHeatmap(
  hm: GexHeatmap | null | undefined,
  todayEt: string
): { expiry: string | null; strikeTotals: Record<string, number>; total: number } {
  if (!hm?.gex?.cells) {
    return { expiry: null, strikeTotals: {}, total: 0 };
  }
  const expiry = resolveOdteExpiry(hm.expiries ?? [], todayEt);
  const strikes = hm.strikes ?? Object.keys(hm.gex.cells).map(Number).filter(Number.isFinite);
  const strikeTotals = odteStrikeTotalsFromCells(hm.gex.cells, strikes, expiry);
  let total = 0;
  for (const v of Object.values(strikeTotals)) {
    if (Number.isFinite(v)) total += v;
  }
  return { expiry, strikeTotals, total };
}

/**
 * Net gamma is "hairline" when |net| is small relative to gross (Σ|per-strike|).
 * In balanced-dealer regimes (~5% net vs ~95% offsetting gamma), cross-provider SIGN
 * disagreements are methodology noise, not a user-visible wrong number.
 */
export function isHairlineNetGammaSign(net: number, grossAbs: number, maxRatio = 0.08): boolean {
  if (!Number.isFinite(net) || !Number.isFinite(grossAbs) || grossAbs <= 0) return false;
  return Math.abs(net) / grossAbs <= maxRatio;
}

/**
 * Spot is "near the gamma flip" when |spot − flip| is a small fraction of spot.
 * In this zone summed net GEX sign is structurally unstable — tiny strike-grid /
 * methodology differences between Polygon ($-gamma per 1% move) and UW (gamma·OI)
 * flip the sign even when King/walls agree. Cross-provider sign checks downgrade
 * to consistency-only here (same rationale as data-validator posture/net_gex INFO).
 */
export function isNearGammaFlip(
  spot: number,
  flip: number | null | undefined,
  maxFractionalOfSpot = 0.005
): boolean {
  if (!(spot > 0) || flip == null || !Number.isFinite(flip)) return false;
  return Math.abs(spot - flip) / spot <= maxFractionalOfSpot;
}

export function grossAbsFromStrikeTotals(strikeTotals: Record<string, number>): number {
  let gross = 0;
  for (const v of Object.values(strikeTotals)) {
    if (Number.isFinite(v)) gross += Math.abs(v);
  }
  return gross;
}

export function grossAbsFromUwGexRows(rows: Array<Record<string, unknown>>): number {
  let gross = 0;
  for (const r of rows) {
    const net = Number(r.call_gamma_oi ?? 0) + Number(r.put_gamma_oi ?? 0);
    if (Number.isFinite(net)) gross += Math.abs(net);
  }
  return gross;
}

// Re-exported from the canonical shared location for downstream consumers.
export { kingFromStrikeTotals } from "@/lib/providers/gex-cross-validation-core";

export type ScopedGexLevels = {
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  king: number | null;
  netTotal: number;
};

// Re-exported from the canonical shared location (bidirectional: both neg→pos AND pos→neg crossings).
export { zeroGammaFlip as computeZeroGammaFlip } from "@/lib/providers/gex-cross-validation-core";

/**
 * Walls + flip + king from a scoped strike-total map (0DTE column or near-term aggregate).
 * Uses the same rules as the heatmap server + GexHeatmap client.
 */
export function recomputeScopedGexLevels(
  strikeTotals: Record<string, number>,
  spot: number
): ScopedGexLevels {
  const entries = Object.entries(strikeTotals)
    .map(([s, v]) => ({ strike: Number(s), value: v }))
    .filter((e) => Number.isFinite(e.strike) && e.value !== 0)
    .sort((a, b) => a.strike - b.strike);

  let callWall: number | null = null;
  let putWall: number | null = null;
  let posMax = -Infinity;
  let negMin = Infinity;
  for (const e of entries) {
    if (e.value > posMax) {
      posMax = e.value;
      callWall = e.strike;
    }
    if (e.value < negMin) {
      negMin = e.value;
      putWall = e.strike;
    }
  }
  if (posMax <= 0) callWall = null;
  if (negMin >= 0) putWall = null;

  let netTotal = 0;
  for (const v of Object.values(strikeTotals)) {
    if (Number.isFinite(v)) netTotal += v;
  }

  return {
    flip: computeZeroGammaFlip(strikeTotals, spot),
    callWall,
    putWall,
    king: kingFromStrikeTotals(strikeTotals),
    netTotal,
  };
}

/** Near-term aggregate scope from a served heatmap (matches desk header / gex-positioning). */
export function nearTermGexScopeFromHeatmap(hm: GexHeatmap | null | undefined): {
  strikeTotals: Record<string, number>;
  total: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
} {
  const gex = hm?.gex;
  if (!gex?.strike_totals) {
    return { strikeTotals: {}, total: 0, flip: null, callWall: null, putWall: null };
  }
  return {
    strikeTotals: gex.strike_totals,
    total: gex.total,
    flip: gex.flip,
    callWall: gex.call_wall,
    putWall: gex.put_wall,
  };
}
