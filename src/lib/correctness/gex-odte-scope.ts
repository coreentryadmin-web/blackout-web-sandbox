import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";

/**
 * Resolve the 0DTE expiry column from a heatmap's expiry axis.
 * Prefers today's ET date when present; otherwise the nearest front expiry.
 */
export function resolveOdteExpiry(expiries: string[], todayEt: string): string | null {
  if (expiries.length === 0) return null;
  return expiries.includes(todayEt) ? todayEt : expiries[0] ?? null;
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

/** Argmax |net| strike — the GEX King node. */
export function kingFromStrikeTotals(strikeTotals: Record<string, number>): number | null {
  let king: number | null = null;
  let maxAbs = -1;
  for (const [s, gRaw] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    const g = Number(gRaw);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    if (Math.abs(g) > maxAbs) {
      maxAbs = Math.abs(g);
      king = strike;
    }
  }
  return king;
}
