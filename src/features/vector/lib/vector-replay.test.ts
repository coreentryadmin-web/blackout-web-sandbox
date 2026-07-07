import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReplayTimeline,
  flipAtCrosshairTime,
  flipAtReplayTime,
  sliceBarsToTime,
  sliceHistoryToTime,
  timelineIndexAtOrAfterEtClock,
  timelineIndexAtOrBeforeEtClock,
  wallsAtCrosshairTime,
  wallsAtReplayTime,
} from "@/features/vector/lib/vector-replay";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { WallHistorySample } from "@/features/vector/lib/vector-wall-history";

function walls(call: number, put: number): GexWalls {
  return {
    callWalls: [{ strike: call, pct: 12 }],
    putWalls: [{ strike: put, pct: 10 }],
  };
}

// 2026-07-07 EDT — 13:30 UTC = 9:30 ET, 20:00 UTC = 16:00 ET
const OPEN = 1_783_431_000;
const NOON = 1_783_434_600;
const CLOSE = 1_783_454_400;

test("timelineIndexAtOrAfterEtClock: finds 9:30 ET on session day", () => {
  const timeline = [OPEN - 60, OPEN, NOON, CLOSE];
  const idx = timelineIndexAtOrAfterEtClock(timeline, "2026-07-07", 9, 30);
  assert.equal(idx, 1);
});

test("timelineIndexAtOrBeforeEtClock: finds 4:00 PM ET on session day", () => {
  const timeline = [OPEN, NOON, CLOSE, CLOSE + 60];
  const idx = timelineIndexAtOrBeforeEtClock(timeline, "2026-07-07", 16, 0);
  assert.equal(idx, 2);
});

// Regression: hovering/scrubbing the Vector chart at a time BEFORE the earliest recorded
// wall sample used to silently fall back to today's LIVE wall/flip state, mislabeling it as
// the historical state at the hovered time — same bug shape as the 0DTE TRIM narrative fix
// (a stale/absent value masquerading as current). wallsAtReplayTime/flipAtReplayTime are
// honest (return null when the cursor predates all samples); the bug was in these callers'
// "?? live" fallback treating that null the same as "no history exists at all."
const LIVE = walls(7600, 7400);
const SAMPLE = walls(7550, 7450);
const HISTORY: WallHistorySample[] = [
  { time: 1000, walls: SAMPLE, gammaFlip: 7500 },
  { time: 2000, walls: SAMPLE, gammaFlip: 7505 },
];

test("wallsAtCrosshairTime: hovering before the earliest sample returns null, not today's live walls", () => {
  const result = wallsAtCrosshairTime(HISTORY, 500 /* before HISTORY[0].time */, "gex", LIVE, null);
  assert.equal(result, null);
});

test("wallsAtCrosshairTime: hovering at/after a recorded sample returns that historical sample, not live", () => {
  const result = wallsAtCrosshairTime(HISTORY, 1500, "gex", LIVE, null);
  assert.deepEqual(result, SAMPLE);
  assert.notDeepEqual(result, LIVE);
});

test("wallsAtCrosshairTime: crosshair off the chart (hoverEpochSec null) falls back to live", () => {
  const result = wallsAtCrosshairTime(HISTORY, null, "gex", LIVE, null);
  assert.deepEqual(result, LIVE);
});

test("wallsAtCrosshairTime: zero history ever recorded falls back to live — nothing else to show", () => {
  const result = wallsAtCrosshairTime([], 1500, "gex", LIVE, null);
  assert.deepEqual(result, LIVE);
});

test("flipAtCrosshairTime: hovering before the earliest sample returns null, not today's live flip", () => {
  const flip = flipAtCrosshairTime(HISTORY, 500, "gex", 7777, null);
  assert.equal(flip, null);
});

test("flipAtCrosshairTime: hovering at/after a recorded sample returns that historical flip, not live", () => {
  const flip = flipAtCrosshairTime(HISTORY, 1500, "gex", 7777, null);
  assert.equal(flip, 7500);
});
