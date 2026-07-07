import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

/** Client-safe SPX pulse shape (Grid Pulse strip + dashboard). */
export type SpxState = {
  available: boolean;
  source?: "polygon" | "blackout_intel" | "merged";
  as_of: string;
  price: number;
  vwap: number;
  lod: number;
  hod: number;
  vix: number | null;
  vix_change_pct: number | null;
  spx_change_pct: number;
  above_vwap: boolean;
  uw_iv_rank: number | null;
  gex_net: number | null;
  gex_king: number | null;
  max_pain: number | null;
  gamma_flip: number | null;
  flow_0dte_call_premium: number | null;
  flow_0dte_put_premium: number | null;
  flow_0dte_net: number | null;
  adv: number | null;
  dec: number | null;
  trin: number | null;
  tick: number | null;
  sector_bias: string | null;
  sector_leaders: Array<{ sector: string; change_pct: number }>;
  sector_laggards: Array<{ sector: string; change_pct: number }>;
  tide_bias: string | null;
  tide_call: number | null;
  tide_put: number | null;
  nope: { nope: number; call_delta: number; put_delta: number } | null;
  vol_regime: { realized_vol: number; skew: number } | null;
  chart_levels: {
    regime: string | null;
    vah: number | null;
    val: number | null;
    poc: number | null;
    fib_382: number | null;
    fib_50: number | null;
    fib_618: number | null;
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    onh: number | null;
    onl: number | null;
    pdh: number | null;
    pdl: number | null;
  };
};

export function emptySpxState(): SpxState {
  return {
    available: false,
    as_of: new Date().toISOString(),
    price: 0,
    vwap: 0,
    lod: 0,
    hod: 0,
    vix: null,
    vix_change_pct: null,
    spx_change_pct: 0,
    above_vwap: false,
    uw_iv_rank: null,
    gex_net: null,
    gex_king: null,
    max_pain: null,
    gamma_flip: null,
    flow_0dte_call_premium: null,
    flow_0dte_put_premium: null,
    flow_0dte_net: null,
    adv: null,
    dec: null,
    trin: null,
    tick: null,
    sector_bias: null,
    sector_leaders: [],
    sector_laggards: [],
    tide_bias: null,
    tide_call: null,
    tide_put: null,
    nope: null,
    vol_regime: null,
    chart_levels: {
      regime: null,
      vah: null,
      val: null,
      poc: null,
      fib_382: null,
      fib_50: null,
      fib_618: null,
      ema20: null,
      ema50: null,
      ema200: null,
      onh: null,
      onl: null,
      pdh: null,
      pdl: null,
    },
  };
}

/** Map merged desk payload → Grid/dashboard pulse state. */
export function deskPayloadToSpxState(desk: SpxDeskPayload): SpxState {
  const mb = desk.market_breadth;
  const breadthSample = mb?.sample_size ?? 0;
  const advCount =
    mb && mb.pct_advancing != null && breadthSample > 0
      ? Math.round((mb.pct_advancing / 100) * breadthSample)
      : null;
  const decCount = advCount != null && breadthSample > 0 ? breadthSample - advCount : null;

  return {
    available: desk.available && desk.price > 0,
    source: desk.source?.includes("engine") ? "blackout_intel" : "merged",
    as_of: desk.polled_at ?? desk.as_of,
    price: desk.price,
    vwap: desk.vwap ?? 0,
    lod: desk.lod ?? 0,
    hod: desk.hod ?? 0,
    vix: desk.vix,
    vix_change_pct: desk.vix_change_pct,
    spx_change_pct: desk.spx_change_pct,
    above_vwap: desk.above_vwap,
    uw_iv_rank: desk.uw_iv_rank,
    gex_net: desk.gex_net,
    gex_king: desk.gex_king,
    max_pain: desk.max_pain,
    gamma_flip: desk.gamma_flip,
    flow_0dte_call_premium: desk.flow_0dte_call_premium,
    flow_0dte_put_premium: desk.flow_0dte_put_premium,
    flow_0dte_net: desk.flow_0dte_net,
    adv: advCount,
    dec: decCount,
    trin: desk.trin,
    tick: desk.tick,
    sector_bias: null,
    sector_leaders: (desk.leader_stocks ?? []).map((s) => ({
      sector: s.name || s.ticker,
      change_pct: s.change_pct,
    })),
    sector_laggards: [],
    tide_bias: desk.tide_bias,
    tide_call: desk.tide_call_premium,
    tide_put: desk.tide_put_premium,
    nope:
      desk.nope != null
        ? {
            nope: desk.nope,
            call_delta: 0,
            put_delta: desk.nope_net_delta ?? 0,
          }
        : null,
    vol_regime: null,
    chart_levels: {
      regime: desk.regime,
      vah: null,
      val: null,
      poc: null,
      fib_382: null,
      fib_50: null,
      fib_618: null,
      ema20: desk.ema20,
      ema50: desk.ema50,
      ema200: desk.ema200,
      onh: desk.hod,
      onl: desk.lod,
      pdh: desk.pdh,
      pdl: desk.pdl,
    },
  };
}
