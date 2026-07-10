import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consecutiveClosesVsLevel,
  openingRangeFromBars,
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
