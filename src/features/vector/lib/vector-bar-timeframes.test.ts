import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateVectorBars,
  wallCountForTimeframe,
  VECTOR_WALL_NODES_PER_SIDE,
  VECTOR_PRESET_TIMEFRAMES,
  isPresetTimeframe,
} from "./vector-bar-timeframes";

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

test("VECTOR_PRESET_TIMEFRAMES: includes the 30m + 60m intraday roll-ups", () => {
  assert.deepEqual([...VECTOR_PRESET_TIMEFRAMES], [1, 3, 5, 15, 30, 60]);
  assert.ok(isPresetTimeframe(30) && isPresetTimeframe(60), "30/60 are presets");
  assert.ok(!isPresetTimeframe(45), "non-preset stays custom");
});

test("aggregateVectorBars: 60m rolls a session's 1m bars into hourly buckets", () => {
  const base = 60 * 3600; // aligned to a 60m boundary
  const bars = [
    m1(base, 100, 101, 99, 100.5),
    m1(base + 60, 100.5, 103, 100, 102), // same hour → merges
    m1(base + 3600, 102, 104, 101, 103), // next hour → new bucket
  ];
  const out = aggregateVectorBars(bars, 60);
  assert.equal(out.length, 2, "two hourly buckets");
  assert.equal(out[0]!.open, 100);
  assert.equal(out[0]!.high, 103, "high across the hour");
  assert.equal(out[0]!.low, 99, "low across the hour");
  assert.equal(out[0]!.close, 102, "last close in the hour");
  assert.equal(out[1]!.open, 102);
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

test("wallCountForTimeframe: preset timeframes map to the specified shown-counts", () => {
  assert.equal(wallCountForTimeframe(1), 6, "1m shows 6 near-spot walls");
  assert.equal(wallCountForTimeframe(3), 8, "3m shows 8");
  assert.equal(wallCountForTimeframe(5), 10, "5m shows 10");
  assert.equal(wallCountForTimeframe(15), 12, "15m shows 12");
  assert.equal(wallCountForTimeframe(30), 14, "30m steps up to 14");
  assert.equal(wallCountForTimeframe(60), 16, "60m steps up to 16");
  assert.equal(wallCountForTimeframe(120), 18, "2h shows 18");
});

test("wallCountForTimeframe: never exceeds VECTOR_WALL_NODES_PER_SIDE, even for huge intervals", () => {
  assert.equal(VECTOR_WALL_NODES_PER_SIDE, 20);
  for (const tf of [15, 30, 60, 120, 240]) {
    assert.ok(
      wallCountForTimeframe(tf) <= VECTOR_WALL_NODES_PER_SIDE,
      `tf=${tf} must not exceed the server cap`
    );
  }
  assert.equal(wallCountForTimeframe(240), 20, "largest interval saturates at the cap");
});

test("wallCountForTimeframe: monotonic non-decreasing across ascending timeframes", () => {
  // Sub-1m / zero / negative clamp up to at least 1; higher tf never returns fewer walls.
  const tfs = [0, 1, 2, 3, 4, 5, 6, 10, 15, 30, 240];
  let prev = 0;
  for (const tf of tfs) {
    const count = wallCountForTimeframe(tf);
    assert.ok(count >= 1, `tf=${tf} clamps to >= 1`);
    assert.ok(count >= prev, `tf=${tf} (${count}) must be >= previous (${prev})`);
    prev = count;
  }
});

test("mergeBarsByTime: fills reconnect holes, prefers fetched OHLC, preserves live volume", async () => {
  const { mergeBarsByTime } = await import("./vector-bar-timeframes");
  const mk = (t: number, px: number, volume?: number) => ({
    time: t, open: px, high: px, low: px, close: px, ...(volume != null ? { volume } : {}),
  });
  const existing = [mk(60, 1, 500), mk(120, 2), mk(300, 5)]; // hole at 180/240
  const fetched = [mk(60, 1.5), mk(120, 2.5, 900), mk(180, 3), mk(240, 4)];
  const merged = mergeBarsByTime(existing, fetched);
  assert.deepEqual(merged.map((b) => b.time), [60, 120, 180, 240, 300], "holes filled, sorted");
  assert.equal(merged[0]!.close, 1.5, "fetched OHLC replaces live-built bar");
  assert.equal(merged[0]!.volume, 500, "live volume survives a volumeless fetched row");
  assert.equal(merged[1]!.volume, 900, "fetched volume wins when present");
  assert.equal(merged[4]!.close, 5, "existing bars beyond the fetch window survive");
});
