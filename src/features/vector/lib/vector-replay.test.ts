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

// Regression: VectorChart's timeframe-resync effect re-fires on every replayMode
// change (e.g. immediately after enterReplay()'s own cursor-sliced applyFrame call)
// and, before this fix, redrew the candle series from the FULL live minuteBars array
// with no cursorTime — leaking bars after the replay cursor onto a chart whose clock
// label still read the earlier cursor time. The fix routes that redraw through
// applyFrame (same as scrubTo/stepReplay/enterReplay), which slices via
// sliceBarsToTime — this pins the exact invariant that slice must uphold: no bar
// timestamped after the cursor may ever appear in a replay-mode display.
test("sliceBarsToTime: bars after the replay cursor (the 'leaked live data' bug) are excluded", () => {
  const cursorTime = OPEN + 300; // 5 minutes into the session
  const bars = [
    { time: OPEN, open: 1, high: 1, low: 1, close: 1 },
    { time: cursorTime, open: 2, high: 2, low: 2, close: 2 },
    { time: cursorTime + 60, open: 3, high: 3, low: 3, close: 3 }, // "live/future" bar
    { time: NOON, open: 4, high: 4, low: 4, close: 4 }, // "live/future" bar
  ];
  const sliced = sliceBarsToTime(bars, cursorTime);
  assert.deepEqual(
    sliced.map((b) => b.time),
    [OPEN, cursorTime],
    "no bar after the cursor may leak into a replay-mode display"
  );
});

// Regression for the SECOND occurrence of the replay leak (2026-07-11): the 60s
// SPY-volume backfill effect painted displayBarsFromMinute(fullLiveBars, timeframe)
// with NO cursorTime while replay was active — the lib-level slice was correct, the
// component call site simply bypassed it. Any paint that runs during replay must
// compose slice-then-aggregate; this pins that composition for a >1m timeframe:
// the aggregate of the cursor-sliced minutes must end at the cursor's bucket and
// carry no post-cursor minute's range, while the unsliced aggregate (what the buggy
// call site painted) visibly differs.
test("slice-then-aggregate: post-cursor minutes never reach a higher-timeframe replay paint", async () => {
  const { aggregateVectorBars } = await import("@/features/vector/lib/vector-bar-timeframes");
  const mk = (t: number, px: number) => ({ time: t, open: px, high: px, low: px, close: px });
  const bars = [
    mk(OPEN, 10),
    mk(OPEN + 60, 11),
    mk(OPEN + 120, 12), // cursor lands here, mid 5m bucket
    mk(OPEN + 180, 99), // post-cursor spike that must NOT appear
    mk(OPEN + 240, 100),
  ];
  const cursorTime = OPEN + 120;
  const honest = aggregateVectorBars(sliceBarsToTime(bars, cursorTime), 5);
  const leaked = aggregateVectorBars(bars, 5);
  assert.equal(honest.length, 1);
  assert.equal(honest[0]!.high, 12, "post-cursor spike leaked into the replay bucket");
  assert.notDeepEqual(honest, leaked, "unsliced aggregate must differ — else this test proves nothing");
});

// ── Multi-day replay (15-session seed): the timeline may now span sessions ─────────────────

// Two sessions one day apart. Session 1 walls differ from session 2 so leakage is detectable.
const DAY = 24 * 60 * 60;
const S1_T0 = 1_800_000;
const S2_T0 = S1_T0 + DAY;
const TWO_DAY_HISTORY: WallHistorySample[] = [
  { time: S1_T0, walls: walls(7550, 7450), gammaFlip: 7500 },
  { time: S1_T0 + 60, walls: walls(7555, 7450), gammaFlip: 7502 },
  { time: S2_T0, walls: walls(7650, 7550), gammaFlip: 7600 },
  { time: S2_T0 + 60, walls: walls(7660, 7550), gammaFlip: 7605 },
];
const TWO_DAY_BARS = [S1_T0, S1_T0 + 60, S2_T0, S2_T0 + 60].map((time) => ({
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
}));

test("multi-day replay: cursor in session 1 must not show session 2 walls or bars", () => {
  const cursor = S1_T0 + 60; // scrubbed to the end of session 1
  const history = sliceHistoryToTime(TWO_DAY_HISTORY, cursor);
  assert.deepEqual(history.map((s) => s.time), [S1_T0, S1_T0 + 60], "session-2 samples excluded");
  const bars = sliceBarsToTime(TWO_DAY_BARS, cursor);
  assert.deepEqual(bars.map((b) => b.time), [S1_T0, S1_T0 + 60], "session-2 bars excluded");
  // The wall ladder AT the cursor is session 1's latest reading — never tomorrow's structure.
  assert.equal(wallsAtReplayTime(TWO_DAY_HISTORY, cursor, "gex")?.callWalls[0]?.strike, 7555);
  assert.equal(flipAtReplayTime(TWO_DAY_HISTORY, cursor, "gex"), 7502);
});

test("multi-day replay: cursor in session 2 reads session 2 structure (not stuck on day 1)", () => {
  const cursor = S2_T0;
  assert.equal(wallsAtReplayTime(TWO_DAY_HISTORY, cursor, "gex")?.callWalls[0]?.strike, 7650);
  assert.equal(flipAtReplayTime(TWO_DAY_HISTORY, cursor, "gex"), 7600);
});

test("multi-day replay: the timeline is the sorted union across both sessions (no fabricated overnight steps)", () => {
  const timeline = buildReplayTimeline(TWO_DAY_HISTORY, TWO_DAY_BARS);
  assert.deepEqual(timeline, [S1_T0, S1_T0 + 60, S2_T0, S2_T0 + 60]);
});
