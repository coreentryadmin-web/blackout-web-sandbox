import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBieFullStateAnswer } from "@/lib/bie/platform-read-format";
import type { BieFullState } from "@/lib/bie/full-platform-cache";

describe("platform-read-format", () => {
  it("formats extended full state with product sections", () => {
    const state: BieFullState = {
      asOf: "2026-07-17T14:00:00.000Z",
      platform: {
        spx: { price: 6300, change_pct: 0.4, gamma_flip: 6280, gamma_regime: "long" },
        flows: { count: 120, total_premium: 45_000_000, top_tickers: [{ ticker: "NVDA" }] },
        nighthawk: { available: true, play_count: 5, edition_for: "2026-07-17" },
      },
      intel: { composite_regime: "TREND", gex_regime: "POS", flow_regime: "BULL", critical_anomaly_count: 0 },
      vectorUniverse: null,
      darkPool: null,
      hotTickers: [{ ticker: "SPY", premium: 2_000_000 }],
      thermalSpx: {
        ticker: "SPX",
        spot: 6300,
        change_pct: 0.4,
        asof: "2026-07-17T14:00:00.000Z",
        flip: 6280,
        call_wall: 6350,
        put_wall: 6250,
        max_pain: 6290,
        gex_king_strike: 6300,
        net_gex: 1_000_000_000,
        net_vex: 500_000_000,
        net_dex: null,
        net_charm: null,
        gamma_posture: "long",
        vanna_posture: "positive",
        gamma_regime_read: "Dealers long gamma",
        vanna_regime_read: "Positive vanna",
        dex_regime_read: null,
        charm_regime_read: null,
      },
      thermalSpy: null,
      thermalQqq: null,
      thermalMatrix: {
        ticker: "SPX",
        spot: 6300,
        asof: "2026-07-17T14:00:00.000Z",
        gex_flip: 6280,
        vex_flip: 6275,
        dex_zero: null,
        charm_zero: null,
        call_wall: 6350,
        put_wall: 6250,
        max_pain: 6290,
        net_gex: 1e9,
        net_vex: 5e8,
        net_dex: null,
        net_charm: null,
        gex_king_strike: 6300,
        top_gex_strikes: [{ strike: 6300, gex: 1e8 }],
        strike_count: 50,
        expiry_count: 8,
      },
      vectorSpx: { spot: 6300, gamma_flip: 6280, gamma_regime: "long", call_wall: 6350, put_wall: 6250 },
      zerodte: { plays: [{ ticker: "NVDA", status: "OPEN", direction: "long", strike: 140 }] },
      regime: { regime_label: "RISK_ON", risk_tone: "bullish", session_phase: "RTH" },
      marketContext: null,
      errors: {},
    };
    const text = formatBieFullStateAnswer(state);
    assert.match(text, /SPX Slayer/);
    assert.match(text, /HELIX/);
    assert.match(text, /Thermal SPX/);
    assert.match(text, /SPX matrix/);
    assert.match(text, /Vector SPX/);
    assert.match(text, /0DTE Command/);
  });
});
