import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consecutiveClosesVsLevel,
  hodLodBreakoutFlags,
  openingRangeFromBars,
  rollingRangeFromBars,
  sessionBreakoutExtremesFromBars,
  vwapSideStreaks,
} from "./spx-play-technicals";

type Bar = { t: number; o: number; h: number; l: number; c: number };

/** Build ET-local minute bars for 2026-07-09 (EDT = UTC-4). */
function etBar(hour: number, min: number, c: number, h?: number, l?: number): Bar {
  const utc = Date.parse(
    `2026-07-09T${String(hour + 4).padStart(2, "0")}:${String(min).padStart(2, "0")}:00.000Z`
  );
  return { t: utc, o: c, h: h ?? c + 1, l: l ?? c - 1, c };
}

test("openingRangeFromBars: undefined until OR window completes", () => {
  const bars = [etBar(9, 30, 7400, 7405, 7395), etBar(9, 40, 7410, 7412, 7398)];
  // 09:40 ET — still inside 20m OR
  const early = openingRangeFromBars(bars, 20, 9 * 60 + 40);
  assert.equal(early.or_defined, false);
  assert.equal(early.or_high, null);
});

test("openingRangeFromBars: freezes high/low after OR minutes", () => {
  const bars = [
    etBar(9, 30, 7400, 7405, 7395),
    etBar(9, 35, 7410, 7415, 7398),
    etBar(9, 45, 7420, 7425, 7410), // after OR — must not expand range
    etBar(10, 0, 7430, 7435, 7420),
  ];
  const or = openingRangeFromBars(bars, 15, 10 * 60);
  assert.equal(or.or_defined, true);
  assert.equal(or.or_high, 7415);
  assert.equal(or.or_low, 7395);
  assert.equal(or.or_minutes, 15);
});

test("vwapSideStreaks: trailing minutes below/above", () => {
  const bars = [
    etBar(10, 0, 7390),
    etBar(10, 1, 7385),
    etBar(10, 2, 7380),
    etBar(10, 3, 7375),
  ];
  const s = vwapSideStreaks(bars, 7382);
  assert.equal(s.minutes_below_vwap, 2); // 7380, 7375
  assert.equal(s.minutes_above_vwap, 0);
});

test("rollingRangeFromBars: uses trailing window not session extremes", () => {
  const bars = [
    etBar(9, 35, 7450, 7455, 7445),
    etBar(10, 0, 7400, 7402, 7398),
    etBar(10, 15, 7395, 7397, 7393),
    etBar(10, 29, 7392, 7394, 7390),
    etBar(10, 30, 7391, 7393, 7389),
  ];
  const r = rollingRangeFromBars(bars, 30);
  assert.equal(r.rolling_30m_high, 7402);
  assert.equal(r.rolling_30m_low, 7389);
});

test("consecutiveClosesVsLevel: counts trailing m3 closes", () => {
  const bars = [
    { t: 1, o: 1, h: 1, l: 1, c: 100 },
    { t: 2, o: 1, h: 1, l: 1, c: 110 },
    { t: 3, o: 1, h: 1, l: 1, c: 111 },
    { t: 4, o: 1, h: 1, l: 1, c: 112 },
  ];
  assert.equal(consecutiveClosesVsLevel(bars, 109, "above", 0), 3);
  assert.equal(consecutiveClosesVsLevel(bars, 109, "below", 0), 0);
});

test("sessionBreakoutExtremesFromBars: excludes forming last bar", () => {
  const bars = [
    { t: 1, o: 100, h: 105, l: 99, c: 104 },
    { t: 2, o: 104, h: 110, l: 103, c: 109 },
  ];
  const ext = sessionBreakoutExtremesFromBars(bars);
  assert.equal(ext.hod, 105);
  assert.equal(ext.lod, 99);
});

test("sessionBreakoutExtremesFromBars: single bar uses open as reference", () => {
  const ext = sessionBreakoutExtremesFromBars([{ t: 1, o: 5500, h: 5505, l: 5498, c: 5503 }]);
  assert.equal(ext.hod, 5500);
  assert.equal(ext.lod, 5500);
});

test("hodLodBreakoutFlags: fires when price clears prior session high", () => {
  const flags = hodLodBreakoutFlags(5505, { hod: 5500, lod: 5400 }, 0.25);
  assert.equal(flags.hod_break, true);
  assert.equal(flags.lod_break, false);
});

test("hodLodBreakoutFlags: spot-widened desk HOD=price cannot fire — bar path can", () => {
  const price = 5505;
  const widenedHod = price;
  assert.equal(widenedHod != null && price > widenedHod + 0.25, false);
  const ext = sessionBreakoutExtremesFromBars([
    { t: 1, o: 5480, h: 5500, l: 5470, c: 5495 },
    { t: 2, o: 5495, h: 5505, l: 5490, c: 5505 },
  ]);
  const flags = hodLodBreakoutFlags(price, ext, 0.25);
  assert.equal(flags.hod_break, true);
});

test("hodLodBreakoutFlags: lod_break when price clears prior session low", () => {
  const ext = sessionBreakoutExtremesFromBars([
    { t: 1, o: 5500, h: 5510, l: 5400, c: 5490 },
    { t: 2, o: 5390, h: 5395, l: 5385, c: 5388 },
  ]);
  const flags = hodLodBreakoutFlags(5380, ext, 0.25);
  assert.equal(flags.lod_break, true);
  assert.equal(flags.hod_break, false);
});
