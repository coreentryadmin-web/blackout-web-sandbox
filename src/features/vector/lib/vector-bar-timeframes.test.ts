import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateVectorBars } from "./vector-bar-timeframes";

const m1 = (
  timeSec: number,
  o: number,
  h: number,
  l: number,
  c: number,
  volume?: number
) => ({
  time: timeSec,
  open: o,
  high: h,
  low: l,
  close: c,
  ...(volume != null ? { volume } : {}),
});

test("aggregateVectorBars: 1m passthrough unchanged", () => {
  const bars = [m1(1000, 1, 2, 0.5, 1.5), m1(1060, 1.5, 2.5, 1, 2)];
  assert.deepEqual(aggregateVectorBars(bars, 1), bars);
});

test("aggregateVectorBars: 3m merges OHLC across three 1m bars", () => {
  const base = 180 * 1000;
  const bars = [
    m1(base, 100, 101, 99, 100.5),
    m1(base + 60, 100.5, 102, 100, 101),
    m1(base + 120, 101, 103, 100.5, 102.5),
    m1(base + 180, 102.5, 104, 102, 103),
  ];
  const out = aggregateVectorBars(bars, 3);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.time, base);
  assert.equal(out[0]!.open, 100);
  assert.equal(out[0]!.high, 103);
  assert.equal(out[0]!.low, 99);
  assert.equal(out[0]!.close, 102.5);
  assert.equal(out[1]!.open, 102.5);
  assert.equal(out[1]!.close, 103);
});

test("aggregateVectorBars: 15m aligns buckets to interval boundary", () => {
  const bucket = 900;
  const t0 = bucket * 100;
  const bars = [m1(t0, 1, 2, 0.5, 1.5), m1(t0 + 60, 1.5, 2.5, 1, 2)];
  const out = aggregateVectorBars(bars, 15);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.time, t0);
  assert.equal(out[0]!.close, 2);
});

test("aggregateVectorBars: sums volume within higher-interval buckets", () => {
  const base = 300 * 60;
  const bars = [
    m1(base, 10, 11, 9, 10.5, 100),
    m1(base + 60, 10.5, 12, 10, 11, 200),
    m1(base + 120, 11, 12, 10.5, 11.5, 50),
  ];
  const out = aggregateVectorBars(bars, 5);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.volume, 350);
});

test("aggregateVectorBars: custom 10m interval buckets", () => {
  const base = 600 * 60;
  const bars = [
    m1(base, 1, 2, 0.5, 1.5),
    m1(base + 60, 1.5, 2.5, 1, 2),
    m1(base + 600, 2, 3, 1.5, 2.5),
  ];
  const out = aggregateVectorBars(bars, 10);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.close, 2);
  assert.equal(out[1]!.close, 2.5);
});
