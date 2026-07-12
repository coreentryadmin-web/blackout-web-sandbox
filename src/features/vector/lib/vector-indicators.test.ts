import { test } from "node:test";
import assert from "node:assert/strict";
import {
  smaSeries,
  emaSeries,
  vwapSeries,
  rsiSeries,
  macdSeries,
} from "./vector-indicators";

const approx = (a: number | null, b: number, eps = 1e-6) => {
  assert.ok(a != null && Math.abs(a - b) < eps, `expected ~${b}, got ${a}`);
};

test("smaSeries: trailing mean, null in the warm-up region", () => {
  assert.deepEqual(smaSeries([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  // period longer than the series → all null; period<=0 → all null.
  assert.deepEqual(smaSeries([1, 2], 5), [null, null]);
  assert.deepEqual(smaSeries([1, 2, 3], 0), [null, null, null]);
});

test("emaSeries: SMA seed then k=2/(period+1) recursion", () => {
  // period 3 (k=0.5), seed = mean(1,2,3)=2 at idx2; idx3 = 10*0.5 + 2*0.5 = 6.
  const out = emaSeries([1, 2, 3, 10], 3);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  approx(out[2], 2);
  approx(out[3], 6);
});

test("vwapSeries: session-cumulative typical×volume; null before any volume", () => {
  const bars = [
    { high: 10, low: 10, close: 10, volume: 100 }, // typical 10
    { high: 20, low: 20, close: 20, volume: 300 }, // typical 20
  ];
  const out = vwapSeries(bars);
  approx(out[0], 10);
  approx(out[1], (10 * 100 + 20 * 300) / 400); // 17.5
});

test("vwapSeries: no volume anywhere → null (never substituted with price)", () => {
  const bars = [
    { high: 10, low: 9, close: 9.5 },
    { high: 11, low: 10, close: 10.5, volume: 0 },
  ];
  assert.deepEqual(vwapSeries(bars), [null, null]);
});

test("rsiSeries: too-short → null; all-gains → 100; all-losses → 0", () => {
  assert.deepEqual(rsiSeries([1, 2, 3], 14), [null, null, null]);
  const up = Array.from({ length: 20 }, (_, i) => i + 1); // strictly increasing
  assert.equal(rsiSeries(up, 14).at(-1), 100);
  const down = Array.from({ length: 20 }, (_, i) => 20 - i); // strictly decreasing
  assert.equal(rsiSeries(down, 14).at(-1), 0);
});

test("rsiSeries: Wilder smoothing matches a hand-computed period-2 case", () => {
  // closes [1,3,2,4], deltas +2,-1,+2, period 2.
  // idx2: avgGain=1, avgLoss=0.5 → RS=2 → 66.667; idx3: avgGain=1.5, avgLoss=0.25 → RS=6 → 85.714.
  const out = rsiSeries([1, 3, 2, 4], 2);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  approx(out[2], 100 - 100 / 3, 1e-4);
  approx(out[3], 100 - 100 / 7, 1e-4);
});

test("macdSeries: constant closes → macd/signal/histogram all 0 where defined", () => {
  const closes = new Array(40).fill(100);
  const out = macdSeries(closes, 12, 26, 9);
  // Warm-up: macd null before the slow EMA seed (index 25).
  assert.equal(out[24]!.macd, null);
  approx(out[25]!.macd, 0);
  // Signal defined 9 macd-points later (index 33); histogram = macd - signal = 0.
  assert.equal(out[32]!.signal, null);
  approx(out[33]!.signal, 0);
  approx(out[33]!.histogram, 0);
});

test("macdSeries: histogram === macd - signal wherever both are defined (ramp)", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 1.5 + Math.sin(i) * 3);
  const out = macdSeries(closes, 12, 26, 9);
  let checked = 0;
  for (const p of out) {
    if (p.macd != null && p.signal != null) {
      approx(p.histogram, p.macd - p.signal, 1e-9);
      checked++;
    }
    // histogram is defined exactly when signal is.
    assert.equal(p.histogram != null, p.signal != null);
  }
  assert.ok(checked > 10, "several defined points exercised");
});
