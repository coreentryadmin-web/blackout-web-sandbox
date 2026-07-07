import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { mergePulseIntoDesk, resetSpxDeskMergeCache } from "./spx-desk-merge";
import type { SpxDeskPayload, SpxDeskPulse } from "@/features/spx/lib/spx-desk";

function deskStub(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return {
    available: true,
    as_of: "2026-06-30T13:00:00.000Z",
    source: "polygon",
    price: 7390,
    spx_change_pct: 0.5,
    vix: 12,
    vix_change_pct: null,
    above_vwap: true,
    lod: 7294.18,
    hod: 7392.95,
    vwap: 7350,
    pdh: 7380,
    pdl: 7280,
    prior_close: 7300,
    gap_pct: null,
    gap_source: null,
    ema20: 7350,
    ema50: 7320,
    ema200: 7200,
    sma50: 7340,
    sma200: 7180,
    tick: null,
    trin: null,
    add: null,
    gex_net: null,
    gex_king: null,
    max_pain: null,
    gamma_flip: null,
    above_gamma_flip: false,
    gamma_regime: "unknown",
    gex_walls: [],
    flow_0dte_call_premium: null,
    flow_0dte_put_premium: null,
    flow_0dte_net: null,
    tide_bias: null,
    tide_call_premium: null,
    tide_put_premium: null,
    tide_net: null,
    nope: null,
    nope_net_delta: null,
    uw_iv_rank: null,
    regime: "bullish",
    levels: [],
    dark_pool: null,
    spx_flows: [],
    unified_tape: [],
    strike_stacks: [],
    net_prem_ticks: [],
    vix_term: { vix9d: null, vix3m: null, structure: "unknown", detail: "" },
    data_quality: { vix_term_partial: false, missing: [] },
    sector_heat: [],
    leader_stocks: [],
    oi_changes: [],
    iv_term_structure: [],
    macro_events: [],
    news_headlines: [],
    greek_exposure: null,
    flow_by_expiry: [],
    net_flow_by_expiry: [],
    market_breadth: null,
    mag7_greek_flow: null,
    macro_indicators: [],
    market_open: true,
    ...overrides,
  };
}

function pulseStub(overrides: Partial<SpxDeskPulse> = {}): SpxDeskPulse {
  return {
    available: true,
    polled_at: "2026-06-30T13:29:00.000Z",
    price: 7440.43,
    spx_change_pct: 0.8,
    vix: 12,
    vix_change_pct: null,
    above_vwap: true,
    lod: 7294.18,
    hod: 7392.95,
    vwap: 7350,
    pdh: 7380,
    pdl: 7280,
    prior_close: 7300,
    gap_pct: null,
    gap_source: null,
    ema20: 7350,
    ema50: 7320,
    ema200: 7200,
    sma50: 7340,
    sma200: 7180,
    tick: null,
    trin: null,
    add: null,
    internals_estimated: { tick: false, trin: false, add: false },
    regime: "bullish",
    leader_stocks: [],
    vix_term: { vix9d: null, vix3m: null, structure: "unknown", detail: "" },
    data_quality: { vix_term_partial: false, missing: [] },
    market_open: true,
    market_status: "open",
    market_label: "OPEN",
    ...overrides,
  };
}

describe("mergePulseIntoDesk session extremes", () => {
  beforeEach(() => {
    resetSpxDeskMergeCache();
  });

  it("expands HOD to live spot when minute-bar lane lags", () => {
    const merged = mergePulseIntoDesk(deskStub(), pulseStub());
    assert.equal(merged.price, 7440.43);
    assert.equal(merged.hod, 7440.43);
    assert.equal(merged.lod, 7294.18);
    assert.ok(merged.price <= (merged.hod ?? 0));
    assert.ok(merged.price >= (merged.lod ?? 0));
  });
});
