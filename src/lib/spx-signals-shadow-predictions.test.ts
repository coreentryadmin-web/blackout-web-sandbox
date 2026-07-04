import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { PredictionConsensusSignal } from "@/lib/providers/unusual-whales";
import {
  computeMacroPredictionsShadowFactor,
  resolveMacroWindowState,
  MACRO_PREDICTION_TICKERS,
} from "./spx-signals-shadow-predictions";

// Minimal desk stub — only `macro_events`/`price` matter to this module (mirrors
// spx-signals-shadow.test.ts's own deskStub() convention).
function deskStub(macroEvents: SpxDeskPayload["macro_events"] = []): SpxDeskPayload {
  return { available: true, price: 7420, macro_events: macroEvents } as SpxDeskPayload;
}

function cpiEvent(overrides: Partial<{ time: string; event: string }> = {}) {
  return { time: "08:30", event: "CPI", country: "US", impact: "high", actual: null, estimate: null, ...overrides };
}

function fomcEvent(overrides: Partial<{ time: string; event: string }> = {}) {
  return {
    time: "14:00",
    event: "FOMC Decision",
    country: "US",
    impact: "high",
    actual: null,
    estimate: null,
    ...overrides,
  };
}

function signal(overrides: Partial<PredictionConsensusSignal> = {}): PredictionConsensusSignal {
  return {
    ticker: "SPY",
    direction: "bullish",
    confidence_pct: 82,
    sources: ["smart_money"],
    headline: "smart money 82% bullish on SPY",
    ...overrides,
  };
}

// 2026-07-04 is EDT (UTC-4), so 08:30 ET == 12:30Z. CPI's real hard-block window
// (macroBlockWindow on a precise time) is [08:25, 09:30) ET == mins [505,570].
const INSIDE_CPI = Date.parse("2026-07-04T12:35:00.000Z"); // 08:35 ET, mins=515 — inside [505,570]
const NEAR_CPI_PREWINDOW = Date.parse("2026-07-04T12:05:00.000Z"); // 08:05 ET, mins=485 — inside [475,505)
const FAR_FROM_CPI = Date.parse("2026-07-04T15:00:00.000Z"); // 11:00 ET, mins=660 — well outside
// FOMC afternoon window is fedMins ± 15 = [13:45,14:15) ET == mins [825,855].
const INSIDE_FOMC = Date.parse("2026-07-04T18:00:00.000Z"); // 14:00 ET, mins=840 — inside [825,855]

test("resolveMacroWindowState: no macro events today — not near, not active", () => {
  const state = resolveMacroWindowState(deskStub([]), FAR_FROM_CPI);
  assert.equal(state.near, false);
  assert.equal(state.active, false);
  assert.equal(state.event_slug, null);
});

test("resolveMacroWindowState: well outside a real CPI event's window — not near", () => {
  const state = resolveMacroWindowState(deskStub([cpiEvent()]), FAR_FROM_CPI);
  assert.equal(state.near, false);
  assert.equal(state.active, false);
});

test("resolveMacroWindowState: inside CPI's real hard-block window — active AND near", () => {
  const state = resolveMacroWindowState(deskStub([cpiEvent()]), INSIDE_CPI);
  assert.equal(state.active, true);
  assert.equal(state.near, true);
  assert.equal(state.event_slug, "cpi");
});

test("resolveMacroWindowState: 25min before CPI's window starts — near but NOT active (pre-positioning lead)", () => {
  const state = resolveMacroWindowState(deskStub([cpiEvent()]), NEAR_CPI_PREWINDOW);
  assert.equal(state.active, false);
  assert.equal(state.near, true);
  assert.equal(state.event_slug, "cpi");
});

test("resolveMacroWindowState: inside FOMC's afternoon Fed window — active AND near, slug 'fomc'", () => {
  const state = resolveMacroWindowState(deskStub([fomcEvent()]), INSIDE_FOMC);
  assert.equal(state.active, true);
  assert.equal(state.near, true);
  assert.equal(state.event_slug, "fomc");
});

test("resolveMacroWindowState: a non-hard-block macro event (e.g. ISM) on the calendar is ignored", () => {
  const state = resolveMacroWindowState(
    deskStub([{ time: "10:00", event: "ISM Manufacturing", country: "US", impact: "medium", actual: null, estimate: null }]),
    Date.parse("2026-07-04T14:00:00.000Z") // 10:00 ET, would be "inside" if ISM counted
  );
  assert.equal(state.near, false);
  assert.equal(state.active, false);
});

test("computeMacroPredictionsShadowFactor: outside any macro window — available:true, weight 0, neutral ('not applicable', distinct from stale/missing)", () => {
  const [obs] = computeMacroPredictionsShadowFactor(deskStub([cpiEvent()]), [signal()], true, FAR_FROM_CPI);
  assert.equal(obs.available, true);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
  assert.equal(obs.factor_name, "macro_prediction_consensus");
  assert.match(obs.detail, /not applicable/);
});

test("computeMacroPredictionsShadowFactor: inside window but consensus not fresh — available:false regardless of what consensusSignals contains", () => {
  const withRealSignal = computeMacroPredictionsShadowFactor(deskStub([cpiEvent()]), [signal()], false, INSIDE_CPI);
  assert.equal(withRealSignal.length, 1);
  assert.equal(withRealSignal[0].available, false);
  assert.equal(withRealSignal[0].implied_weight, 0);
  assert.equal(withRealSignal[0].direction, "neutral");
  assert.equal(withRealSignal[0].factor_name, "macro_prediction_cpi");

  const withNullSignals = computeMacroPredictionsShadowFactor(deskStub([cpiEvent()]), null, true, INSIDE_CPI);
  assert.equal(withNullSignals[0].available, false);

  // Guard rule: a stale/unavailable consensus feed must never be silently reported as a
  // confirmed "no signal" reading.
  assert.deepEqual(withRealSignal, withNullSignals);
});

test("computeMacroPredictionsShadowFactor: inside window, fresh feed, clear bullish SPY consensus — positive implied_weight", () => {
  const [obs] = computeMacroPredictionsShadowFactor(
    deskStub([cpiEvent()]),
    [signal({ ticker: "SPY", direction: "bullish", confidence_pct: 82 })],
    true,
    INSIDE_CPI
  );
  assert.equal(obs.available, true);
  assert.equal(obs.direction, "bullish");
  assert.equal(obs.implied_weight, 13); // 80th-pct tier
  assert.equal(obs.factor_name, "macro_prediction_cpi");
  assert.match(obs.detail, /active hard-block window/);
  assert.match(obs.detail, /82% bullish on SPY/);
});

test("computeMacroPredictionsShadowFactor: near (pre-window) with clear bearish QQQ consensus — negative implied_weight, phase noted as pre-window", () => {
  const [obs] = computeMacroPredictionsShadowFactor(
    deskStub([cpiEvent()]),
    [signal({ ticker: "QQQ", direction: "bearish", confidence_pct: 93 })],
    true,
    NEAR_CPI_PREWINDOW
  );
  assert.equal(obs.direction, "bearish");
  assert.equal(obs.implied_weight, -18); // >=90th-pct tier, negative for bearish
  assert.match(obs.detail, /pre-window/);
});

test("computeMacroPredictionsShadowFactor: inside window, SPY and QQQ disagree — mixed, weight 0", () => {
  const [obs] = computeMacroPredictionsShadowFactor(
    deskStub([cpiEvent()]),
    [
      signal({ ticker: "SPY", direction: "bullish", confidence_pct: 88 }),
      signal({ ticker: "QQQ", direction: "bearish", confidence_pct: 90 }),
    ],
    true,
    INSIDE_CPI
  );
  assert.equal(obs.available, true);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
  assert.match(obs.detail, /mixed\/unclear/);
});

test("computeMacroPredictionsShadowFactor: inside window, confidence below the 'clear' threshold — mixed, weight 0", () => {
  const [obs] = computeMacroPredictionsShadowFactor(
    deskStub([cpiEvent()]),
    [signal({ ticker: "SPY", direction: "bullish", confidence_pct: 58 })],
    true,
    INSIDE_CPI
  );
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
});

test("computeMacroPredictionsShadowFactor: inside window, API already called it 'neutral' — treated as not-clear, weight 0", () => {
  const [obs] = computeMacroPredictionsShadowFactor(
    deskStub([cpiEvent()]),
    [signal({ ticker: "SPY", direction: "neutral", confidence_pct: 95 })],
    true,
    INSIDE_CPI
  );
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
});

test("computeMacroPredictionsShadowFactor: inside window, fresh feed, but no SPY/QQQ signal in the consensus set — available:true, weight 0, distinct detail", () => {
  const [obs] = computeMacroPredictionsShadowFactor(
    deskStub([cpiEvent()]),
    [signal({ ticker: "TSLA", direction: "bullish", confidence_pct: 95 })],
    true,
    INSIDE_CPI
  );
  assert.equal(obs.available, true);
  assert.equal(obs.implied_weight, 0);
  assert.match(obs.detail, /no SPY\/QQQ prediction-market consensus signal/);
});

test("computeMacroPredictionsShadowFactor: SPY and QQQ agree — strongest confidence sets the weight", () => {
  const [obs] = computeMacroPredictionsShadowFactor(
    deskStub([cpiEvent()]),
    [
      signal({ ticker: "SPY", direction: "bullish", confidence_pct: 71 }),
      signal({ ticker: "QQQ", direction: "bullish", confidence_pct: 91 }),
    ],
    true,
    INSIDE_CPI
  );
  assert.equal(obs.direction, "bullish");
  assert.equal(obs.implied_weight, 18); // strongest (QQQ 91%) sets the tier
});

test("MACRO_PREDICTION_TICKERS is exactly SPY/QQQ (broad-market proxies, no single names)", () => {
  assert.deepEqual([...MACRO_PREDICTION_TICKERS].sort(), ["QQQ", "SPY"]);
});
