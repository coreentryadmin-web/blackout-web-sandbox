import test from "node:test";
import assert from "node:assert/strict";
import { buildPlaybookShadowPanel } from "./playbook-shadow-panel";
import { EMPTY_PLAYBOOK_BAR_METRICS, type PlayTechnicals } from "./spx-play-technicals";
import type { SpxDeskPayload } from "./spx-desk";

const TECH: PlayTechnicals = {
  available: true,
  price: 7501,
  m1_bars: 100,
  m5_trend: "up",
  m5_ema20: 7500,
  m5_rsi: 55,
  m5_rsi_warning: null,
  m3_close: 7501,
  m5_close: 7501,
  m3_above_vwap: true,
  breakout: {
    vwap_reclaim: true,
    vwap_lost: false,
    hod_break: false,
    lod_break: false,
    pdh_break: false,
    pdl_break: false,
  },
  mtf: {
    m3_confirms_long: true,
    m3_confirms_short: false,
    m5_confirms_long: true,
    m5_confirms_short: false,
  },
  ...EMPTY_PLAYBOOK_BAR_METRICS,
};

const DESK = {
  available: true,
  market_open: true,
  price: 7501,
  vwap: 7498,
  above_vwap: true,
  regime: "Bullish",
  flow_0dte_net: 1_000_000,
} as SpxDeskPayload;

test("buildPlaybookShadowPanel returns null when technicals unavailable", () => {
  assert.equal(buildPlaybookShadowPanel(DESK, { ...TECH, available: false }), null);
});

test("buildPlaybookShadowPanel returns all registry verdicts in shadow mode", () => {
  const panel = buildPlaybookShadowPanel(DESK, TECH);
  assert.ok(panel);
  assert.equal(panel!.mode, "shadow");
  assert.equal(panel!.verdicts.length, 14);
  assert.equal(panel!.verdicts[0]?.playbook_id, "PB-01");
  assert.equal(panel!.verdicts[0]?.name, "VWAP Reclaim");
  assert.equal(panel!.verdicts[3]?.playbook_id, "PB-04");
  assert.equal(panel!.verdicts[7]?.playbook_id, "PB-08");
});
