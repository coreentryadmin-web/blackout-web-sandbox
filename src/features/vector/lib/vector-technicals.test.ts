import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTechnicals, technicalsCallouts, type TechnicalsBar } from "./vector-technicals";

// RTH ET anchor (09:30 ET Mon 2026-07-13): VWAP is now RTH-gated (P1-A), so fixture bars must sit
// inside the 09:30–16:00 window or vwapSeries treats them as premarket and returns null. 60 1m bars
// from 09:30 → 10:29, all RTH.
const RTH_BASE = Math.floor(Date.parse("2026-07-13T09:30:00-04:00") / 1000);

/** Build bars from a close path: high=c+0.5, low=c-0.5, volume=1000, 1m spacing from the RTH open. */
const barsFrom = (closes: number[]): TechnicalsBar[] =>
  closes.map((c, i) => ({ time: RTH_BASE + 60 * i, high: c + 0.5, low: c - 0.5, close: c, volume: 1000 }));

// Accelerating (convex) trends, not linear ramps: a linear ramp makes MACD ≈ signal exactly, whose
// bull/bear tie resolves on floating-point noise. A real accelerating trend keeps macd clearly on
// one side of its signal, which is the honest read the terminal narrates.
const ACCEL_UP = Array.from({ length: 60 }, (_, i) => 100 + 0.5 * i + 0.03 * i * i); // convex rise
const ACCEL_DOWN = Array.from({ length: 60 }, (_, i) => 300 - 0.5 * i - 0.03 * i * i); // convex fall

test("summarizeTechnicals: accelerating uptrend → bullish EMA stack, overbought RSI, price above VWAP, MACD bullish", () => {
  const bars = barsFrom(ACCEL_UP);
  const s = summarizeTechnicals(bars, ACCEL_UP[ACCEL_UP.length - 1]!);

  assert.equal(s.emaStack, "bullish", "9>21>50 on a rise");
  assert.ok(s.ema9! > s.ema21! && s.ema21! > s.ema50!);
  assert.equal(s.rsiZone, "overbought", "strong rise → RSI ≥ 70");
  assert.ok(s.rsi! >= 70);
  assert.equal(s.macdState, "bullish", "macd line above signal on an accelerating rise");
  assert.ok(s.vwap != null && s.vwapDeltaPct != null && s.vwapDeltaPct > 0, "price leads the cumulative VWAP");

  const lines = technicalsCallouts(s);
  assert.ok(lines.some((l) => l.startsWith("VWAP ")), "VWAP line present");
  assert.ok(lines.some((l) => l.includes("stacked bullish")), "EMA stack line");
  assert.ok(lines.some((l) => l.startsWith("RSI ") && l.includes("overbought")), "RSI line");
  assert.ok(lines.some((l) => l.startsWith("MACD bullish")), "MACD line");
});

test("summarizeTechnicals: accelerating downtrend → bearish EMA stack + oversold RSI + MACD bearish", () => {
  const s = summarizeTechnicals(barsFrom(ACCEL_DOWN), ACCEL_DOWN[ACCEL_DOWN.length - 1]!);
  assert.equal(s.emaStack, "bearish", "9<21<50 on a decline");
  assert.equal(s.rsiZone, "oversold");
  assert.equal(s.macdState, "bearish");
  assert.ok(s.vwapDeltaPct! < 0, "price below the cumulative VWAP on a decline");
});

test("summarizeTechnicals: too few bars → higher-lookback studies degrade to null, no lines for them", () => {
  const bars = barsFrom([100, 101, 102, 101, 103]); // 5 bars
  const s = summarizeTechnicals(bars, 103);
  assert.equal(s.ema50, null, "50-EMA needs 50 bars");
  assert.equal(s.emaStack, null);
  assert.equal(s.rsi, null, "RSI(14) needs 14+");
  assert.equal(s.rsiZone, null);
  assert.equal(s.macdState, null, "MACD needs the slow-EMA seed");
  // VWAP computes from one bar, so its line can still appear; the momentum lines must not.
  const lines = technicalsCallouts(s);
  assert.ok(!lines.some((l) => l.includes("EMA 9/21/50")), "no EMA-stack line");
  assert.ok(!lines.some((l) => l.startsWith("RSI ")), "no RSI line");
  assert.ok(!lines.some((l) => l.startsWith("MACD ")), "no MACD line");
});

test("summarizeTechnicals: a real swing yields a golden pocket; empty bars yield an empty readout", () => {
  // A path with a confirmed low pivot then a dominant up-leg (same shape the fib-swing engine tests
  // use) — a pure monotonic ramp has no internal pivots, so it would (correctly) yield no swing.
  const BIG_THEN_SMALL = [100, 98, 95, 100, 105, 108, 110, 107, 105, 104, 105, 106, 107, 106, 105];
  const s = summarizeTechnicals(barsFrom(BIG_THEN_SMALL), 105);
  assert.ok(s.goldenPocket != null, "dominant swing → golden pocket");
  assert.ok(s.goldenPocket!.high > s.goldenPocket!.low, "pocket returned low-to-high");

  const empty = summarizeTechnicals([], null);
  assert.equal(empty.spot, null);
  assert.equal(empty.vwap, null);
  assert.deepEqual(technicalsCallouts(empty), [], "no bars → nothing to narrate");
});

test("summarizeTechnicals: spot defaults to the last close when not provided", () => {
  const bars = barsFrom([100, 105, 110]);
  assert.equal(summarizeTechnicals(bars, null).spot, 110);
  assert.equal(summarizeTechnicals(bars, 0).spot, 110, "invalid spot also falls back to last close");
});
