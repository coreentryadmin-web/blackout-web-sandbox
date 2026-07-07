import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

/** Compact JSON block injected into Largo system prompt — same feed as SPX Sniper UI. */
export function formatLargoSpxLiveContext(desk: SpxDeskPayload): string {
  if (!desk.available || desk.price <= 0) {
    return "SPX Sniper desk offline (session closed or Polygon unavailable). Use get_spx_structure for a fresh pull.";
  }

  const snapshot = {
    source: "spx_sniper_merged_desk",
    as_of: desk.polled_at ?? desk.as_of,
    market: desk.market_label ?? desk.market_status,
    market_open: desk.market_open,
    price: desk.price,
    change_pct: desk.spx_change_pct,
    vix: desk.vix,
    vwap: desk.vwap,
    above_vwap: desk.above_vwap,
    hod: desk.hod,
    lod: desk.lod,
    pdh: desk.pdh,
    pdl: desk.pdl,
    gamma_flip: desk.gamma_flip,
    above_gamma_flip: desk.above_gamma_flip,
    gamma_regime: desk.gamma_regime,
    gex_net: desk.gex_net,
    gex_king: desk.gex_king,
    max_pain: desk.max_pain,
    gex_walls: desk.gex_walls?.slice(0, 6),
    flow_0dte_net: desk.flow_0dte_net,
    tide_bias: desk.tide_bias,
    tide_net: desk.tide_net,
    nope: desk.nope,
    iv_rank: desk.uw_iv_rank,
    tick: desk.tick,
    trin: desk.trin,
    add: desk.add,
    regime: desk.regime,
    vix_term: desk.vix_term,
    recent_tape: desk.unified_tape?.slice(0, 6),
    recent_flows: desk.spx_flows?.slice(0, 6),
    news: desk.news_headlines?.slice(0, 3).map((n) => n.title),
  };

  return JSON.stringify(snapshot);
}

export function isSpxTicker(ticker: string): boolean {
  const t = ticker.toUpperCase().replace(/^I:/, "");
  return t === "SPX" || t === "SPXW";
}
