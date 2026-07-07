import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import {
  computeSkewShadowFactor,
  computeVolDivergenceShadowFactor,
  type RiskReversalSkewReading,
  type VolDivergenceReading,
} from "./spx-signals-shadow-skew";

// Minimal desk stub — neither factor function reads desk fields today (see the module doc's
// `void desk;`), so only `available`/`price` need to be present to satisfy the type.
function deskStub(): SpxDeskPayload {
  return { available: true, price: 7420 } as SpxDeskPayload;
}

const NOW = Date.parse("2026-07-04T18:00:00.000Z");
const FRESH_DATE = "2026-07-02"; // 2 days before NOW — inside the 5-day freshness window
const STALE_DATE = "2026-06-20"; // 14 days before NOW — outside the window

// ---------------------------------------------------------------------------
// computeSkewShadowFactor
// ---------------------------------------------------------------------------

test("computeSkewShadowFactor: null reading (both SPX and SPY empty) — available:false", () => {
  const obs = computeSkewShadowFactor(deskStub(), null, NOW);
  assert.equal(obs.factor_name, "risk_reversal_skew");
  assert.equal(obs.available, false);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
  assert.match(obs.detail, /no data for SPX or SPY/);
});

test("computeSkewShadowFactor: stale reading (latest row older than the 5-day window) — available:false, distinct message from null", () => {
  const stale: RiskReversalSkewReading = { ticker: "SPY", date: STALE_DATE, risk_reversal: 0.05 };
  const obs = computeSkewShadowFactor(deskStub(), stale, NOW);
  assert.equal(obs.available, false);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
  assert.match(obs.detail, /older than the 5-day freshness window/);

  const nullObs = computeSkewShadowFactor(deskStub(), null, NOW);
  assert.notEqual(obs.detail, nullObs.detail);
});

test("computeSkewShadowFactor: fresh reading inside the flat band — available:true, weight 0, neutral (distinct from stale/missing)", () => {
  const flat: RiskReversalSkewReading = { ticker: "SPX", date: FRESH_DATE, risk_reversal: 0.005 };
  const obs = computeSkewShadowFactor(deskStub(), flat, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
  assert.match(obs.detail, /flat band/);
});

test("computeSkewShadowFactor: fresh moderate positive skew — bearish, moderate weight", () => {
  const reading: RiskReversalSkewReading = { ticker: "SPY", date: FRESH_DATE, risk_reversal: 0.025 };
  const obs = computeSkewShadowFactor(deskStub(), reading, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.direction, "bearish");
  assert.equal(obs.implied_weight, -4);
  assert.match(obs.detail, /put-side skew \(fear\)/);
});

test("computeSkewShadowFactor: fresh moderate negative skew — bullish, moderate weight", () => {
  const reading: RiskReversalSkewReading = { ticker: "SPY", date: FRESH_DATE, risk_reversal: -0.025 };
  const obs = computeSkewShadowFactor(deskStub(), reading, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.direction, "bullish");
  assert.equal(obs.implied_weight, 4);
  assert.match(obs.detail, /call-side skew \(complacency\)/);
});

test("computeSkewShadowFactor: fresh extreme positive skew (>= 0.05) — bearish, extreme weight", () => {
  const reading: RiskReversalSkewReading = { ticker: "SPY", date: FRESH_DATE, risk_reversal: 0.07 };
  const obs = computeSkewShadowFactor(deskStub(), reading, NOW);
  assert.equal(obs.direction, "bearish");
  assert.equal(obs.implied_weight, -8);
});

test("computeSkewShadowFactor: fresh extreme negative skew — bullish, extreme weight", () => {
  const reading: RiskReversalSkewReading = { ticker: "SPY", date: FRESH_DATE, risk_reversal: -0.06 };
  const obs = computeSkewShadowFactor(deskStub(), reading, NOW);
  assert.equal(obs.direction, "bullish");
  assert.equal(obs.implied_weight, 8);
});

// ---------------------------------------------------------------------------
// computeVolDivergenceShadowFactor
// ---------------------------------------------------------------------------

test("computeVolDivergenceShadowFactor: null reading — available:false", () => {
  const obs = computeVolDivergenceShadowFactor(deskStub(), null, NOW);
  assert.equal(obs.factor_name, "realized_vs_implied_vol");
  assert.equal(obs.available, false);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
  assert.match(obs.detail, /unavailable from both Polygon and the UW fallback/);
});

test("computeVolDivergenceShadowFactor: UW-sourced stale reading — available:false, distinct from missing", () => {
  const stale: VolDivergenceReading = {
    source: "unusual_whales",
    as_of_date: STALE_DATE,
    realized_vol: 0.1,
    implied_vol: 0.13,
  };
  const obs = computeVolDivergenceShadowFactor(deskStub(), stale, NOW);
  assert.equal(obs.available, false);
  assert.match(obs.detail, /older than the 5-day freshness window/);

  const nullObs = computeVolDivergenceShadowFactor(deskStub(), null, NOW);
  assert.notEqual(obs.detail, nullObs.detail);
});

test("computeVolDivergenceShadowFactor: Polygon-sourced reading (as_of_date null) is never stale, even far from `now`", () => {
  const reading: VolDivergenceReading = {
    source: "polygon",
    as_of_date: null,
    realized_vol: 0.087,
    implied_vol: 0.131, // live-observed SPX sample from this PR's investigation
  };
  const farFuture = NOW + 365 * 24 * 60 * 60 * 1000;
  const obs = computeVolDivergenceShadowFactor(deskStub(), reading, farFuture);
  assert.equal(obs.available, true);
});

test("computeVolDivergenceShadowFactor: flat band (|IV-RV| < 0.02) — available:true, weight 0, neutral", () => {
  const reading: VolDivergenceReading = {
    source: "polygon",
    as_of_date: null,
    realized_vol: 0.1,
    implied_vol: 0.11,
  };
  const obs = computeVolDivergenceShadowFactor(deskStub(), reading, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
  assert.match(obs.detail, /flat band/);
});

test("computeVolDivergenceShadowFactor: IV moderately above RV (live-observed SPX sample, 4.4pt spread) — bearish, moderate weight", () => {
  // From this PR's live pull: SPX implied_volatility 0.131 vs realized_volatility 0.087404.
  const reading: VolDivergenceReading = {
    source: "polygon",
    as_of_date: null,
    realized_vol: 0.087404,
    implied_vol: 0.131,
  };
  const obs = computeVolDivergenceShadowFactor(deskStub(), reading, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.direction, "bearish");
  assert.equal(obs.implied_weight, -4);
  assert.match(obs.detail, /implied running rich \(fear premium\)/);
});

test("computeVolDivergenceShadowFactor: IV moderately below RV — bullish, moderate weight", () => {
  const reading: VolDivergenceReading = {
    source: "unusual_whales",
    as_of_date: FRESH_DATE,
    realized_vol: 0.15,
    implied_vol: 0.11,
  };
  const obs = computeVolDivergenceShadowFactor(deskStub(), reading, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.direction, "bullish");
  assert.equal(obs.implied_weight, 4);
  assert.match(obs.detail, /implied running cheap \(complacent\)/);
});

test("computeVolDivergenceShadowFactor: IV extremely above RV (>= 0.05 spread) — bearish, extreme weight", () => {
  const reading: VolDivergenceReading = {
    source: "polygon",
    as_of_date: null,
    realized_vol: 0.08,
    implied_vol: 0.15,
  };
  const obs = computeVolDivergenceShadowFactor(deskStub(), reading, NOW);
  assert.equal(obs.direction, "bearish");
  assert.equal(obs.implied_weight, -8);
});

test("computeVolDivergenceShadowFactor: IV extremely below RV — bullish, extreme weight", () => {
  const reading: VolDivergenceReading = {
    source: "polygon",
    as_of_date: null,
    realized_vol: 0.2,
    implied_vol: 0.1,
  };
  const obs = computeVolDivergenceShadowFactor(deskStub(), reading, NOW);
  assert.equal(obs.direction, "bullish");
  assert.equal(obs.implied_weight, 8);
});
