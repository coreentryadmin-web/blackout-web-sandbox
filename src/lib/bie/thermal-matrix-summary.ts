/** Compact Thermal / GEX matrix summary for BIE full-state (no server-only). */

import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";

export type ThermalMatrixSummary = {
  ticker: string;
  spot: number;
  asof: string;
  gex_flip: number | null;
  vex_flip: number | null;
  dex_zero: number | null;
  charm_zero: number | null;
  call_wall: number | null;
  put_wall: number | null;
  max_pain: number | null;
  net_gex: number;
  net_vex: number;
  net_dex: number | null;
  net_charm: number | null;
  gex_king_strike: number | null;
  /** Top |net-gex| strikes near spot (strike → value). */
  top_gex_strikes: Array<{ strike: number; gex: number }>;
  strike_count: number;
  expiry_count: number;
};

function kingStrike(strikeTotals: Record<string, number> | undefined): number | null {
  if (!strikeTotals) return null;
  let best: { strike: number; mag: number } | null = null;
  for (const [k, v] of Object.entries(strikeTotals)) {
    const strike = Number(k);
    if (!Number.isFinite(strike) || !Number.isFinite(v)) continue;
    const mag = Math.abs(v);
    if (!best || mag > best.mag) best = { strike, mag };
  }
  return best?.strike ?? null;
}

function topStrikesNearSpot(
  strikeTotals: Record<string, number> | undefined,
  spot: number,
  limit = 8
): Array<{ strike: number; gex: number }> {
  if (!strikeTotals || !Number.isFinite(spot)) return [];
  return Object.entries(strikeTotals)
    .map(([k, v]) => ({ strike: Number(k), gex: v }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.gex))
    .sort((a, b) => {
      const da = Math.abs(a.strike - spot);
      const db = Math.abs(b.strike - spot);
      if (da !== db) return da - db;
      return Math.abs(b.gex) - Math.abs(a.gex);
    })
    .slice(0, limit);
}

/** Shrink a full GexHeatmap to citable scalars + near-spot ladder (not the full cell grid). */
export function compactThermalMatrixSummary(hm: GexHeatmap | null | undefined): ThermalMatrixSummary | null {
  if (!hm || !Number.isFinite(hm.spot) || hm.spot <= 0) return null;
  const totals = hm.gex?.strike_totals ?? {};
  return {
    ticker: hm.underlying,
    spot: hm.spot,
    asof: hm.asof,
    gex_flip: hm.gex?.flip ?? null,
    vex_flip: hm.vex?.flip ?? null,
    dex_zero: hm.dex?.zero_level ?? null,
    charm_zero: hm.charm?.zero_level ?? null,
    call_wall: hm.gex?.call_wall ?? null,
    put_wall: hm.gex?.put_wall ?? null,
    max_pain: hm.max_pain ?? null,
    net_gex: hm.gex?.total ?? 0,
    net_vex: hm.vex?.total ?? 0,
    net_dex: hm.dex?.total ?? null,
    net_charm: hm.charm?.total ?? null,
    gex_king_strike: kingStrike(totals),
    top_gex_strikes: topStrikesNearSpot(totals, hm.spot),
    strike_count: hm.strikes?.length ?? 0,
    expiry_count: hm.expiries?.length ?? 0,
  };
}

/** Serializable positioning slice (Thermal canonical contract). */
export type ThermalPositioningSummary = {
  ticker: string;
  spot: number;
  change_pct: number;
  asof: string;
  flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  max_pain: number | null;
  gex_king_strike: number | null;
  net_gex: number;
  net_vex: number;
  net_dex: number | null;
  net_charm: number | null;
  gamma_posture: string | null;
  vanna_posture: string | null;
  gamma_regime_read: string;
  vanna_regime_read: string;
  dex_regime_read: string | null;
  charm_regime_read: string | null;
};

export function compactThermalPositioning(p: {
  ticker: string;
  spot: number;
  change_pct: number;
  asof: string;
  flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  max_pain: number | null;
  gex_king_strike: number | null;
  net_gex: number;
  net_vex: number;
  net_dex: number | null;
  net_charm: number | null;
  gamma_posture: string | null;
  vanna_posture: string | null;
  gamma_regime_read: string;
  vanna_regime_read: string;
  dex_regime_read: string | null;
  charm_regime_read: string | null;
} | null | undefined): ThermalPositioningSummary | null {
  if (!p || !Number.isFinite(p.spot) || p.spot <= 0) return null;
  return {
    ticker: p.ticker,
    spot: p.spot,
    change_pct: p.change_pct,
    asof: p.asof,
    flip: p.flip,
    call_wall: p.call_wall,
    put_wall: p.put_wall,
    max_pain: p.max_pain,
    gex_king_strike: p.gex_king_strike,
    net_gex: p.net_gex,
    net_vex: p.net_vex,
    net_dex: p.net_dex,
    net_charm: p.net_charm,
    gamma_posture: p.gamma_posture,
    vanna_posture: p.vanna_posture,
    gamma_regime_read: p.gamma_regime_read,
    vanna_regime_read: p.vanna_regime_read,
    dex_regime_read: p.dex_regime_read,
    charm_regime_read: p.charm_regime_read,
  };
}
