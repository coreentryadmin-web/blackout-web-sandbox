import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBreadthTone,
  summarizeBreadth,
  assembleBreadthBundle,
  MIN_BREADTH_SAMPLE,
} from "./market-breadth";
import type { MarketBreadthMetrics } from "@/lib/providers/polygon";

function metrics(over: Partial<MarketBreadthMetrics>): MarketBreadthMetrics {
  return {
    advance_decline_ratio: 1,
    pct_above_vwap: 50,
    pct_advancing: 50,
    closed_near_high: 0,
    closed_near_low: 0,
    volume_leaders: [],
    sample_size: 500,
    ...over,
  };
}

test("classifyBreadthTone: symmetric thresholds around 50%", () => {
  assert.equal(classifyBreadthTone(metrics({ pct_advancing: 70 })), "strongly_positive");
  assert.equal(classifyBreadthTone(metrics({ pct_advancing: 58 })), "positive");
  assert.equal(classifyBreadthTone(metrics({ pct_advancing: 50 })), "mixed");
  assert.equal(classifyBreadthTone(metrics({ pct_advancing: 40 })), "negative");
  assert.equal(classifyBreadthTone(metrics({ pct_advancing: 30 })), "strongly_negative");
});

test("classifyBreadthTone: unknown on null / thin sample / null pct", () => {
  assert.equal(classifyBreadthTone(null), "unknown");
  assert.equal(classifyBreadthTone(metrics({ sample_size: MIN_BREADTH_SAMPLE - 1 })), "unknown");
  assert.equal(classifyBreadthTone(metrics({ pct_advancing: null })), "unknown");
});

test("summarizeBreadth: factual line for a negative tape; unavailable when unknown", () => {
  const m = metrics({ pct_advancing: 38, advance_decline_ratio: 0.61, sample_size: 620 });
  const s = summarizeBreadth(m, "negative");
  assert.match(s, /38\.0% advancing/);
  assert.match(s, /A\/D 0\.61/);
  assert.match(s, /620 names/);
  assert.match(s, /negative/);
  assert.match(summarizeBreadth(null, "unknown"), /unavailable/);
});

test("assembleBreadthBundle: wires tone + summary + passthrough", () => {
  const m = metrics({ pct_advancing: 68, advance_decline_ratio: 2.4, sample_size: 700 });
  const movers = [{ ticker: "NVDA", change_pct: 5.1, price: 120, volume: 1_000_000 }];
  const b = assembleBreadthBundle("2026-07-13", m, movers);
  assert.equal(b.as_of, "2026-07-13");
  assert.equal(b.tone, "strongly_positive");
  assert.equal(b.breadth, m);
  assert.deepEqual(b.movers, movers);
  assert.match(b.summary, /strongly positive/);
});

test("assembleBreadthBundle: null breadth → unknown tone + unavailable summary", () => {
  const b = assembleBreadthBundle("2026-07-13", null, []);
  assert.equal(b.tone, "unknown");
  assert.match(b.summary, /unavailable/);
});
