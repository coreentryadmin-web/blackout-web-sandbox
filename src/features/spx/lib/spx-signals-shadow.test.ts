import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { computeShadowFactors, type FlowAnomalyInput } from "./spx-signals-shadow";

// Minimal desk stub — computeShadowFactors doesn't read desk fields today (see the
// module doc's `void desk;`), so only `available`/`price` need to be present to
// satisfy the type.
function deskStub(): SpxDeskPayload {
  return { available: true, price: 7420 } as SpxDeskPayload;
}

const NOW = Date.parse("2026-07-04T18:00:00.000Z");

function anomaly(overrides: Partial<FlowAnomalyInput> = {}): FlowAnomalyInput {
  return {
    ticker: "SPY",
    anomaly_type: "DIRECTIONAL_FLOW_SKEW",
    detected_at: "2026-07-04T17:50:00.000Z", // 10 min before NOW — inside the 30min window
    detail: "extreme call skew (12:1 call/put)",
    severity: "HIGH",
    direction: "bullish",
    ...overrides,
  };
}

test("computeShadowFactors: stale/missing feed — available:false regardless of what `anomalies` contains", () => {
  const withRealAnomaly = computeShadowFactors(deskStub(), [anomaly()], false, NOW);
  assert.equal(withRealAnomaly.length, 1);
  assert.equal(withRealAnomaly[0].available, false);
  assert.equal(withRealAnomaly[0].implied_weight, 0);
  assert.equal(withRealAnomaly[0].direction, "neutral");

  const withEmptyAnomalies = computeShadowFactors(deskStub(), [], false, NOW);
  assert.equal(withEmptyAnomalies[0].available, false);
  assert.equal(withEmptyAnomalies[0].implied_weight, 0);

  // Guard rule under test: a stale feed must NEVER be silently reported as if it
  // were a confirmed "no anomaly" reading — both inputs above collapse to the
  // exact same available:false observation, proving the feed-down case can't be
  // mistaken for a real zero.
  assert.deepEqual(withRealAnomaly, withEmptyAnomalies);
});

test("computeShadowFactors: fresh feed + no anomalies — available:true, implied_weight:0, direction neutral (distinct from stale)", () => {
  const [obs] = computeShadowFactors(deskStub(), [], true, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
  assert.match(obs.detail, /No SPY\/QQQ\/mega-cap flow anomalies/);
});

test("computeShadowFactors: fresh feed + real bullish anomaly on a watched ticker — positive implied_weight, available:true", () => {
  const [obs] = computeShadowFactors(deskStub(), [anomaly({ ticker: "SPY", direction: "bullish", severity: "HIGH" })], true, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.direction, "bullish");
  assert.equal(obs.implied_weight, 7); // HIGH severity magnitude
  assert.equal(obs.factor_name, "flow_anomaly_spy_skew");
  assert.match(obs.detail, /SPY DIRECTIONAL_FLOW_SKEW \(HIGH\)/);
});

test("computeShadowFactors: fresh feed + real bearish anomaly — negative implied_weight", () => {
  const [obs] = computeShadowFactors(
    deskStub(),
    [anomaly({ ticker: "QQQ", direction: "bearish", severity: "CRITICAL", anomaly_type: "LARGE_PREMIUM_PRINT" })],
    true,
    NOW
  );
  assert.equal(obs.direction, "bearish");
  assert.equal(obs.implied_weight, -10); // CRITICAL severity magnitude, negative for bearish
  assert.equal(obs.factor_name, "flow_anomaly_qqq_premium");
});

test("computeShadowFactors: anomaly older than the 30min window is excluded — falls back to the no-anomaly reading", () => {
  const stale = anomaly({ detected_at: "2026-07-04T17:00:00.000Z" }); // 60 min before NOW
  const [obs] = computeShadowFactors(deskStub(), [stale], true, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.factor_name, "flow_anomaly_watch");
});

test("computeShadowFactors: anomaly on a ticker outside SPY/QQQ/mega-caps is ignored", () => {
  const [obs] = computeShadowFactors(deskStub(), [anomaly({ ticker: "GME" })], true, NOW);
  assert.equal(obs.factor_name, "flow_anomaly_watch");
  assert.equal(obs.implied_weight, 0);
});

test("computeShadowFactors: multiple watched tickers each get their own observation, sorted by ticker", () => {
  const obs = computeShadowFactors(
    deskStub(),
    [
      anomaly({ ticker: "TSLA", direction: "bearish", severity: "MEDIUM" }),
      anomaly({ ticker: "AAPL", direction: "bullish", severity: "LOW" }),
    ],
    true,
    NOW
  );
  assert.equal(obs.length, 2);
  assert.equal(obs[0].factor_name, "flow_anomaly_aapl_skew");
  assert.equal(obs[1].factor_name, "flow_anomaly_tsla_skew");
});

test("computeShadowFactors: two anomalies on the SAME ticker in-window collapse to one observation (highest severity wins)", () => {
  const obs = computeShadowFactors(
    deskStub(),
    [
      anomaly({ ticker: "SPY", severity: "LOW", direction: "bullish", anomaly_type: "CONCENTRATION" }),
      anomaly({ ticker: "SPY", severity: "CRITICAL", direction: "bearish", anomaly_type: "LARGE_PREMIUM_PRINT" }),
    ],
    true,
    NOW
  );
  assert.equal(obs.length, 1);
  assert.equal(obs[0].implied_weight, -10);
  assert.equal(obs[0].factor_name, "flow_anomaly_spy_premium");
});

test("computeShadowFactors: unrecognized severity string defaults to the LOW magnitude, not zero", () => {
  const [obs] = computeShadowFactors(deskStub(), [anomaly({ severity: "WEIRD", direction: "bullish" })], true, NOW);
  assert.equal(obs.implied_weight, 3);
});

test("computeShadowFactors: neutral/null direction is available:true with implied_weight 0, not folded into 'no anomaly'", () => {
  const [obs] = computeShadowFactors(deskStub(), [anomaly({ direction: null })], true, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
  // Distinct from the true "no anomaly detected" factor_name — this IS a confirmed
  // detection, just a non-directional one.
  assert.equal(obs.factor_name, "flow_anomaly_spy_skew");
});
