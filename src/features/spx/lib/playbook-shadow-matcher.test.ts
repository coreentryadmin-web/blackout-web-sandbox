import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { EMPTY_PLAYBOOK_BAR_METRICS } from "@/features/spx/lib/spx-play-technicals";
import { matchPlaybooksShadow } from "./playbook-shadow-matcher";

// Full-shape desk fixture — mirrors spx-desk-merge.test.ts's own deskStub() (same
// SpxDeskPayload required-field list), overridable per test.
function deskStub(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return {
    available: true,
    as_of: "2026-07-09T15:00:00.000Z",
    source: "polygon",
    price: 7390,
    spx_change_pct: 0.5,
    vix: 12,
    vix_change_pct: null,
    above_vwap: true,
    lod: 7370,
    hod: 7400,
    vwap: 7380,
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
    gamma_flip: 7360,
    above_gamma_flip: true,
    gamma_regime: "amplification",
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

function technicalsStub(overrides: Partial<PlayTechnicals> = {}): PlayTechnicals {
  return {
    available: true,
    price: 7390,
    m1_bars: 300,
    m3_close: 7390,
    m5_close: 7390,
    m5_ema20: 7385,
    m5_rsi: 55,
    m5_rsi_warning: null,
    m5_trend: "flat",
    m3_above_vwap: true,
    breakout: {
      pdh_break: false,
      pdl_break: false,
      hod_break: false,
      lod_break: false,
      vwap_reclaim: false,
      vwap_lost: false,
    },
    mtf: {
      m3_confirms_long: null,
      m3_confirms_short: null,
      m5_confirms_long: false,
      m5_confirms_short: false,
    },
    ...EMPTY_PLAYBOOK_BAR_METRICS,
    ...overrides,
  };
}

// EDT (UTC-4) in July — 15:00Z = 11:00 ET, inside PB-01 (09:45-14:00) and PB-02
// (10:00-15:00) windows, outside PB-03 (09:35-10:30).
const MID_MORNING_UTC = Date.parse("2026-07-09T15:00:00.000Z");
// 16:00 ET — past every Phase-1 playbook's session window end.
const AFTER_ALL_WINDOWS_UTC = Date.parse("2026-07-09T20:00:00.000Z");
// 10:00 ET — inside PB-03's 09:35-10:30 window.
const OPENING_DRIVE_UTC = Date.parse("2026-07-09T14:00:00.000Z");

// ---------------------------------------------------------------------------
// PB-01 VWAP Reclaim
// ---------------------------------------------------------------------------

test("PB-01: triggers long when preconditions + trigger both true, inside session window", () => {
  const desk = deskStub({ above_vwap: false, vwap: 7380, price: 7383, flow_0dte_net: 500_000 });
  const technicals = technicalsStub({
    minutes_below_vwap: 15,
    m3_close: 7383,
    breakout: { pdh_break: false, pdl_break: false, hod_break: false, lod_break: false, vwap_reclaim: true, vwap_lost: false },
  });
  const result = matchPlaybooksShadow(desk, technicals, MID_MORNING_UTC);
  const pb01 = result.verdicts.find((v) => v.playbook_id === "PB-01")!;
  assert.equal(pb01.session_window_open, true);
  assert.equal(pb01.precondition_match, true);
  assert.equal(pb01.trigger_fired, true);
  assert.equal(pb01.direction, "long");
});

test("PB-01: does not trigger when session window is closed, even with preconditions + trigger true", () => {
  const desk = deskStub({ above_vwap: false, vwap: 7380, price: 7383, flow_0dte_net: 500_000 });
  const technicals = technicalsStub({
    breakout: { pdh_break: false, pdl_break: false, hod_break: false, lod_break: false, vwap_reclaim: true, vwap_lost: false },
  });
  const result = matchPlaybooksShadow(desk, technicals, AFTER_ALL_WINDOWS_UTC);
  const pb01 = result.verdicts.find((v) => v.playbook_id === "PB-01")!;
  assert.equal(pb01.session_window_open, false);
  assert.equal(pb01.trigger_fired, false);
  assert.equal(pb01.direction, null);
});

test("PB-01: unavailable technicals -> no trigger, no precondition, honest 'unavailable' detail", () => {
  const desk = deskStub({ vwap: null });
  const technicals = technicalsStub({ available: false });
  const result = matchPlaybooksShadow(desk, technicals, MID_MORNING_UTC);
  const pb01 = result.verdicts.find((v) => v.playbook_id === "PB-01")!;
  assert.equal(pb01.precondition_match, false);
  assert.equal(pb01.trigger_fired, false);
  assert.match(pb01.detail, /unavailable/);
});

// ---------------------------------------------------------------------------
// PB-02 VWAP Reject
// ---------------------------------------------------------------------------

test("PB-02: triggers short when preconditions + trigger both true, inside session window", () => {
  const desk = deskStub({
    above_vwap: false,
    vwap: 7380,
    price: 7377,
    flow_0dte_net: -400_000,
    regime: "weak",
  });
  const technicals = technicalsStub({
    m3_close: 7377,
    breakout: { pdh_break: false, pdl_break: false, hod_break: false, lod_break: false, vwap_reclaim: false, vwap_lost: true },
  });
  const result = matchPlaybooksShadow(desk, technicals, MID_MORNING_UTC);
  const pb02 = result.verdicts.find((v) => v.playbook_id === "PB-02")!;
  assert.equal(pb02.session_window_open, true);
  assert.equal(pb02.regime_eligible, true);
  assert.equal(pb02.precondition_match, true); // within playStructureProximityPts() of vwap, below
  assert.equal(pb02.trigger_fired, true);
  assert.equal(pb02.direction, "short");
});

test("PB-02: does not trigger when session window is closed", () => {
  const desk = deskStub({
    above_vwap: false,
    vwap: 7380,
    price: 7377,
    flow_0dte_net: -400_000,
    regime: "weak",
  });
  const technicals = technicalsStub({
    breakout: { pdh_break: false, pdl_break: false, hod_break: false, lod_break: false, vwap_reclaim: false, vwap_lost: true },
  });
  // 08:00 ET — before PB-02's 10:00 AM window start.
  const beforeWindow = Date.parse("2026-07-09T12:00:00.000Z");
  const result = matchPlaybooksShadow(desk, technicals, beforeWindow);
  const pb02 = result.verdicts.find((v) => v.playbook_id === "PB-02")!;
  assert.equal(pb02.session_window_open, false);
  assert.equal(pb02.trigger_fired, false);
});

test("PB-02: thin bearish flow does not trigger — materiality threshold", () => {
  const desk = deskStub({
    above_vwap: false,
    vwap: 7380,
    price: 7377,
    flow_0dte_net: -50_000,
    regime: "weak",
  });
  const technicals = technicalsStub({
    breakout: { pdh_break: false, pdl_break: false, hod_break: false, lod_break: false, vwap_reclaim: false, vwap_lost: true },
  });
  const result = matchPlaybooksShadow(desk, technicals, MID_MORNING_UTC);
  const pb02 = result.verdicts.find((v) => v.playbook_id === "PB-02")!;
  assert.equal(pb02.trigger_fired, false);
  assert.match(pb02.detail, /material=false/);
});

test("PB-02: bearish flow required — vwap_lost alone (neutral/missing flow) does not trigger", () => {
  const desk = deskStub({
    above_vwap: false,
    vwap: 7380,
    price: 7377,
    flow_0dte_net: null,
    regime: "weak",
  });
  const technicals = technicalsStub({
    breakout: { pdh_break: false, pdl_break: false, hod_break: false, lod_break: false, vwap_reclaim: false, vwap_lost: true },
  });
  const result = matchPlaybooksShadow(desk, technicals, MID_MORNING_UTC);
  const pb02 = result.verdicts.find((v) => v.playbook_id === "PB-02")!;
  assert.equal(pb02.trigger_fired, false);
});

test("PB-02: bullish regime makes PB-02 ineligible even with a perfect reject setup", () => {
  const desk = deskStub({
    above_vwap: false,
    vwap: 7380,
    price: 7377,
    flow_0dte_net: -400_000,
    regime: "bullish",
  });
  const technicals = technicalsStub({
    breakout: { pdh_break: false, pdl_break: false, hod_break: false, lod_break: false, vwap_reclaim: false, vwap_lost: true },
  });
  const result = matchPlaybooksShadow(desk, technicals, MID_MORNING_UTC);
  const pb02 = result.verdicts.find((v) => v.playbook_id === "PB-02")!;
  assert.equal(pb02.regime_eligible, false);
  assert.equal(pb02.trigger_fired, false);
});

// ---------------------------------------------------------------------------
// PB-03 Opening Range Breakout
// ---------------------------------------------------------------------------

test("PB-03: triggers long when preconditions + trigger both true, inside session window", () => {
  const desk = deskStub({
    hod: 7400,
    lod: 7370,
    price: 7403,
    above_gamma_flip: true,
    gamma_regime: "amplification",
    flow_0dte_net: 250_000,
  });
  const technicals = technicalsStub({
    or_defined: true,
    or_high: 7400,
    or_low: 7370,
    or_minutes: 20,
    breakout: { pdh_break: false, pdl_break: false, hod_break: true, lod_break: false, vwap_reclaim: false, vwap_lost: false },
  });
  const result = matchPlaybooksShadow(desk, technicals, OPENING_DRIVE_UTC);
  const pb03 = result.verdicts.find((v) => v.playbook_id === "PB-03")!;
  assert.equal(pb03.session_window_open, true);
  assert.equal(pb03.precondition_match, true); // gamma_regime !== "mean_revert"
  assert.equal(pb03.trigger_fired, true);
  assert.equal(pb03.direction, "long");
});

test("PB-03: does not trigger when session window is closed (past 10:30 ET)", () => {
  const desk = deskStub({
    hod: 7400,
    lod: 7370,
    price: 7403,
    above_gamma_flip: true,
    gamma_regime: "amplification",
    flow_0dte_net: 250_000,
  });
  const technicals = technicalsStub({
    breakout: { pdh_break: false, pdl_break: false, hod_break: true, lod_break: false, vwap_reclaim: false, vwap_lost: false },
  });
  const result = matchPlaybooksShadow(desk, technicals, MID_MORNING_UTC); // 11:00 ET, past 10:30
  const pb03 = result.verdicts.find((v) => v.playbook_id === "PB-03")!;
  assert.equal(pb03.session_window_open, false);
  assert.equal(pb03.trigger_fired, false);
});

test("PB-03: gamma pinning (mean_revert) blocks precondition_match even with a raw breakout", () => {
  const desk = deskStub({
    hod: 7400,
    lod: 7370,
    price: 7403,
    above_gamma_flip: true,
    gamma_regime: "mean_revert",
    flow_0dte_net: 250_000,
  });
  const technicals = technicalsStub({
    breakout: { pdh_break: false, pdl_break: false, hod_break: true, lod_break: false, vwap_reclaim: false, vwap_lost: false },
  });
  const result = matchPlaybooksShadow(desk, technicals, OPENING_DRIVE_UTC);
  const pb03 = result.verdicts.find((v) => v.playbook_id === "PB-03")!;
  assert.equal(pb03.precondition_match, false);
});

test("PB-03: degraded halt feed suppresses trigger even when breakout + flip + flow all align", () => {
  const desk = deskStub({
    hod: 7400,
    lod: 7370,
    price: 7403,
    above_gamma_flip: true,
    gamma_regime: "amplification",
    flow_0dte_net: 250_000,
    feed_stalled: true,
  });
  const technicals = technicalsStub({
    breakout: { pdh_break: false, pdl_break: false, hod_break: true, lod_break: false, vwap_reclaim: false, vwap_lost: false },
  });
  const result = matchPlaybooksShadow(desk, technicals, OPENING_DRIVE_UTC);
  const pb03 = result.verdicts.find((v) => v.playbook_id === "PB-03")!;
  assert.equal(pb03.trigger_fired, false);
  assert.match(pb03.detail, /degraded/);
});

// ---------------------------------------------------------------------------
// PB-04 Gamma Pin Fade (evidence-backed: see docs/spx/PLAYBOOK-EVIDENCE-BASE.md)
// ---------------------------------------------------------------------------

test("PB-04: fades a resistance wall touch inside a gamma pin (short)", () => {
  const desk = deskStub({
    price: 7398,
    gamma_regime: "mean_revert",
    gex_walls: [
      { strike: 7400, net_gex: 5e9, kind: "resistance", distance_pts: 2 },
      { strike: 7370, net_gex: -4e9, kind: "support", distance_pts: 28 },
    ],
    flow_0dte_net: -100_000,
    regime: "neutral",
  });
  const technicals = technicalsStub();
  // 13:00 ET — inside PB-04's 11:30–15:00 window.
  const midday = Date.parse("2026-07-09T17:00:00.000Z");
  const result = matchPlaybooksShadow(desk, technicals, midday);
  const pb04 = result.verdicts.find((v) => v.playbook_id === "PB-04")!;
  assert.equal(pb04.session_window_open, true);
  assert.equal(pb04.precondition_match, true);
  assert.equal(pb04.trigger_fired, true);
  assert.equal(pb04.direction, "short");
});

test("PB-04: no trigger without gamma pin (amplification regime)", () => {
  const desk = deskStub({
    price: 7398,
    gamma_regime: "amplification",
    gex_walls: [
      { strike: 7400, net_gex: 5e9, kind: "resistance", distance_pts: 2 },
      { strike: 7370, net_gex: -4e9, kind: "support", distance_pts: 28 },
    ],
    flow_0dte_net: -100_000,
    regime: "neutral",
  });
  const midday = Date.parse("2026-07-09T17:00:00.000Z");
  const result = matchPlaybooksShadow(desk, technicalsStub(), midday);
  const pb04 = result.verdicts.find((v) => v.playbook_id === "PB-04")!;
  assert.equal(pb04.precondition_match, false);
  assert.equal(pb04.trigger_fired, false);
});

test("PB-04: live breakout through wall invalidates the fade", () => {
  const desk = deskStub({
    price: 7398,
    gamma_regime: "mean_revert",
    gex_walls: [
      { strike: 7400, net_gex: 5e9, kind: "resistance", distance_pts: 2 },
      { strike: 7370, net_gex: -4e9, kind: "support", distance_pts: 28 },
    ],
    flow_0dte_net: -100_000,
    regime: "neutral",
  });
  const technicals = technicalsStub({
    breakout: { pdh_break: false, pdl_break: false, hod_break: true, lod_break: false, vwap_reclaim: false, vwap_lost: false },
  });
  const midday = Date.parse("2026-07-09T17:00:00.000Z");
  const result = matchPlaybooksShadow(desk, technicals, midday);
  const pb04 = result.verdicts.find((v) => v.playbook_id === "PB-04")!;
  assert.equal(pb04.trigger_fired, false);
  assert.match(pb04.detail, /invalidated/);
});

// ---------------------------------------------------------------------------
// PB-08 Power Hour Momentum (evidence-backed: 14:00+ only net-positive band)
// ---------------------------------------------------------------------------

test("PB-08: triggers long on HOD break with dominant bullish flow in power hour", () => {
  const desk = deskStub({ price: 7405, flow_0dte_net: 900_000, regime: "bullish" });
  const technicals = technicalsStub({
    minutes_above_vwap: 25,
    breakout: { pdh_break: false, pdl_break: false, hod_break: true, lod_break: false, vwap_reclaim: false, vwap_lost: false },
  });
  // 15:15 ET
  const powerHour = Date.parse("2026-07-09T19:15:00.000Z");
  const result = matchPlaybooksShadow(desk, technicals, powerHour);
  const pb08 = result.verdicts.find((v) => v.playbook_id === "PB-08")!;
  assert.equal(pb08.session_window_open, true);
  assert.equal(pb08.trigger_fired, true);
  assert.equal(pb08.direction, "long");
});

test("PB-08: no trigger outside power hour even with dominant flow + break", () => {
  const desk = deskStub({ price: 7405, flow_0dte_net: 900_000, regime: "bullish" });
  const technicals = technicalsStub({
    minutes_above_vwap: 25,
    breakout: { pdh_break: false, pdl_break: false, hod_break: true, lod_break: false, vwap_reclaim: false, vwap_lost: false },
  });
  const result = matchPlaybooksShadow(desk, technicals, MID_MORNING_UTC);
  const pb08 = result.verdicts.find((v) => v.playbook_id === "PB-08")!;
  assert.equal(pb08.session_window_open, false);
  assert.equal(pb08.trigger_fired, false);
});

// ---------------------------------------------------------------------------
// Registry coverage
// ---------------------------------------------------------------------------

test("matchPlaybooksShadow returns one verdict per registry playbook (14)", () => {
  const desk = deskStub();
  const technicals = technicalsStub();
  const result = matchPlaybooksShadow(desk, technicals, MID_MORNING_UTC);
  assert.equal(result.verdicts.length, 14);
  assert.deepEqual(
    result.verdicts.map((v) => v.playbook_id),
    [
      "PB-01", "PB-02", "PB-03", "PB-04", "PB-05", "PB-06", "PB-07", "PB-08",
      "PB-09", "PB-10", "PB-11", "PB-12", "PB-13", "PB-14",
    ]
  );
});

// ---------------------------------------------------------------------------
// Primary-pick logic
// ---------------------------------------------------------------------------

test("primary_playbook_id: null when zero playbooks trigger", () => {
  const desk = deskStub({ above_vwap: true, vwap: 7380, price: 7390, hod: 7400, lod: 7370, flow_0dte_net: null });
  const technicals = technicalsStub(); // all breakout flags false
  const result = matchPlaybooksShadow(desk, technicals, MID_MORNING_UTC);
  assert.equal(result.verdicts.every((v) => v.trigger_fired === false), true);
  assert.equal(result.primary_playbook_id, null);
});

test("primary_playbook_id: the single triggered playbook when exactly one fires", () => {
  const desk = deskStub({ above_vwap: false, vwap: 7380, price: 7383, hod: 7400, lod: 7370, flow_0dte_net: 500_000 });
  const technicals = technicalsStub({
    breakout: { pdh_break: false, pdl_break: false, hod_break: false, lod_break: false, vwap_reclaim: true, vwap_lost: false },
  });
  const result = matchPlaybooksShadow(desk, technicals, MID_MORNING_UTC);
  const triggered = result.verdicts.filter((v) => v.trigger_fired);
  assert.equal(triggered.length, 1);
  assert.equal(result.primary_playbook_id, "PB-01");
});

test("primary_playbook_id: priority-order tie-break when 2+ playbooks trigger simultaneously", () => {
  // PB-03 ORB long + PB-01 long on same tick — PB-03 wins per FULL-SPEC priority.
  const desk = deskStub({
    above_vwap: true,
    vwap: 7380,
    price: 7410,
    hod: 7410,
    lod: 7370,
    flow_0dte_net: 500_000,
    regime: "bullish",
    gamma_regime: "amplification",
    above_gamma_flip: true,
  });
  const technicals = technicalsStub({
    or_defined: true,
    or_high: 7405,
    or_low: 7375,
    or_minutes: 20,
    breakout: {
      pdh_break: false,
      pdl_break: false,
      hod_break: false,
      lod_break: false,
      vwap_reclaim: true,
      vwap_lost: false,
    },
    m3_consecutive_closes_above_vwap: 2,
    minutes_below_vwap: 20,
    ema9_curling_toward_vwap: true,
  });
  const result = matchPlaybooksShadow(desk, technicals, Date.parse("2026-07-09T14:15:00.000Z")); // 10:15 ET
  const triggered = result.verdicts.filter((v) => v.trigger_fired).map((v) => v.playbook_id);
  assert.ok(triggered.includes("PB-01"));
  assert.ok(triggered.includes("PB-03"));
  assert.equal(result.primary_playbook_id, "PB-03");
});
