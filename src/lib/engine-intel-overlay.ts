/** Runtime validation for external engine intel `/spx/state` overlay fields. */

export type EngineIntelOverlay = {
  available: boolean;
  vwap: number | null;
  lod: number | null;
  hod: number | null;
  gamma_flip: number | null;
  gex_net: number | null;
  gex_king: number | null;
  max_pain: number | null;
  vix: number | null;
  vix_change_pct: number | null;
  tick: number | null;
  trin: number | null;
  flow_0dte_call_premium: number | null;
  flow_0dte_put_premium: number | null;
  flow_0dte_net: number | null;
  tide_bias: string | null;
  uw_iv_rank: number | null;
  regime: string | null;
  nope: number | null;
};

function finiteNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function finiteStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Parse and sanitize engine intel payload — drops non-finite numerics instead of casting blindly. */
export function parseEngineIntelOverlay(raw: unknown): EngineIntelOverlay | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const chartLevels =
    o.chart_levels && typeof o.chart_levels === "object"
      ? (o.chart_levels as Record<string, unknown>)
      : null;
  const nopeObj = o.nope && typeof o.nope === "object" ? (o.nope as Record<string, unknown>) : null;

  return {
    available: o.available === true,
    vwap: finiteNum(o.vwap),
    lod: finiteNum(o.lod),
    hod: finiteNum(o.hod),
    gamma_flip: finiteNum(o.gamma_flip),
    gex_net: finiteNum(o.gex_net),
    gex_king: finiteNum(o.gex_king),
    max_pain: finiteNum(o.max_pain),
    vix: finiteNum(o.vix),
    vix_change_pct: finiteNum(o.vix_change_pct),
    tick: finiteNum(o.tick),
    trin: finiteNum(o.trin),
    flow_0dte_call_premium: finiteNum(o.flow_0dte_call_premium),
    flow_0dte_put_premium: finiteNum(o.flow_0dte_put_premium),
    flow_0dte_net: finiteNum(o.flow_0dte_net),
    tide_bias: finiteStr(o.tide_bias),
    uw_iv_rank: finiteNum(o.uw_iv_rank),
    regime: chartLevels ? finiteStr(chartLevels.regime) : null,
    nope: nopeObj ? finiteNum(nopeObj.nope) : finiteNum(o.nope),
  };
}
