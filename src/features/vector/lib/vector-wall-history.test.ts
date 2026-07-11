import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketWallHistoryForInterval,
  liveTrailAnchorSec,
  mergeWallHistory,
  pickActiveStrikes,
  recordWallSample,
  seedWallHistoryForDisplay,
  strikeTrailWeight,
  trailsByStrike,
  trailForFlipLevel,
  trailForGammaFlip,
  trailForRank,
  trimHistoryForLiveTrails,
  LIVE_TRAIL_LOOKBACK_SEC,
  hasVexInHistory,
  type WallHistorySample,
} from "./vector-wall-history";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";

function walls(callStrikes: number[], putStrikes: number[]): GexWalls {
  return {
    callWalls: callStrikes.map((strike, i) => ({ strike, pct: 10 - i })),
    putWalls: putStrikes.map((strike, i) => ({ strike, pct: 8 - i })),
  };
}

test("recordWallSample: appends a new bar time as a new entry", () => {
  const h1 = recordWallSample([], { time: 100, walls: walls([6800], [6700]) });
  const h2 = recordWallSample(h1, { time: 160, walls: walls([6810], [6700]) });
  assert.equal(h2.length, 2);
  assert.deepEqual(h2.map((s) => s.time), [100, 160]);
});

test("recordWallSample: replaces the last entry when the bar is still forming (same time)", () => {
  const h1 = recordWallSample([], { time: 100, walls: walls([6800], [6700]) });
  const h2 = recordWallSample(h1, { time: 100, walls: walls([6805], [6700]) });
  assert.equal(h2.length, 1);
  assert.equal(h2[0].walls.callWalls[0].strike, 6805);
});

test("recordWallSample: trims from the front once the history exceeds the cap", () => {
  let history: WallHistorySample[] = [];
  for (let i = 0; i < 2000; i++) {
    history = recordWallSample(history, { time: i * 15, walls: walls([6800], [6700]) });
  }
  assert.equal(history.length, 1920);
  assert.equal(history[0].time, 80 * 15);
  assert.equal(history[history.length - 1].time, 1999 * 15);
});

test("trailForRank: projects one rank's strike/pct across the history, in order", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800, 6850], [6700]) },
    { time: 160, walls: walls([6810, 6850], [6700, 6650]) },
  ];
  assert.deepEqual(trailForRank(history, "callWalls", 0), [
    { time: 100, strike: 6800, pct: 10 },
    { time: 160, strike: 6810, pct: 10 },
  ]);
});

test("trailForRank: omits bars where that rank didn't exist, instead of inserting a placeholder", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800, 6850], [6700]) }, // rank 1 exists
    { time: 160, walls: walls([6810], [6700]) }, // rank 1 dropped out (ladder thinned)
    { time: 220, walls: walls([6810, 6860], [6700]) }, // rank 1 reappears
  ];
  assert.deepEqual(trailForRank(history, "callWalls", 1), [
    { time: 100, strike: 6850, pct: 9 },
    { time: 220, strike: 6860, pct: 9 },
  ]);
});

test("trailForRank: returns an empty trail for an empty history", () => {
  assert.deepEqual(trailForRank([], "putWalls", 0), []);
});

test("seedWallHistoryForDisplay: seeds one honest dot at the last bar when history is empty", () => {
  const w = walls([6800], [6700]);
  const seeded = seedWallHistoryForDisplay([], [100, 160, 220], w, 6750);
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].time, 220);
  assert.deepEqual(seeded[0].walls, w);
  assert.equal(seeded[0].gammaFlip, 6750);
});

test("seedWallHistoryForDisplay: leaves existing history untouched", () => {
  const existing = recordWallSample([], { time: 100, walls: walls([6800], [6700]) });
  const seeded = seedWallHistoryForDisplay(existing, [100, 160], walls([6810], [6700]));
  assert.equal(seeded, existing);
});

test("seedWallHistoryForDisplay: vex-only seed when GEX ladder empty", () => {
  const vex = walls([6820], [6680]);
  const seeded = seedWallHistoryForDisplay([], [100, 160], null, null, vex, 6760);
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].time, 160);
  assert.deepEqual(seeded[0].vexWalls, vex);
  assert.equal(seeded[0].vexFlip, 6760);
});

test("seedWallHistoryForDisplay: no-op without walls or bars", () => {
  assert.deepEqual(seedWallHistoryForDisplay([], [], walls([6800], [6700])), []);
  assert.deepEqual(seedWallHistoryForDisplay([], [100], null), []);
});

test("trailsByStrike: groups horizontal bead rows per strike — migration splits into two rows", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], []) },
    { time: 160, walls: walls([6800], []) },
    { time: 220, walls: walls([6810], []) },
  ];
  const callTrails = trailsByStrike(history, "callWalls");
  assert.equal(callTrails.size, 2);
  assert.deepEqual(callTrails.get(6800)?.map((p) => p.time), [100, 160]);
  assert.deepEqual(callTrails.get(6810)?.map((p) => p.time), [220]);
});

test("pickActiveStrikes: keeps the heaviest rows when capped", () => {
  const trails = new Map([
    [6800, [{ time: 100, pct: 3 }, { time: 160, pct: 3 }]],
    [6810, [{ time: 100, pct: 9 }]],
    [6820, [{ time: 100, pct: 2 }]],
  ]);
  assert.deepEqual(pickActiveStrikes(trails, 2), [6810, 6800]);
  // Peak-biased weight = max*0.6 + mean*0.4 → 3*0.6 + 3*0.4 = 3 (not the Σ=6 of the old scheme).
  assert.equal(strikeTrailWeight(trails.get(6800)!), 3);
});

test("pickActiveStrikes: a recently-strong wall outranks a persistent-but-weak one (peak-biased)", () => {
  const trails = new Map([
    // Weak wall present ALL session (10 samples @ 3%): old Σpct = 30.
    [6800, Array.from({ length: 10 }, (_, i) => ({ time: 100 + i, pct: 3 }))],
    // Strong wall that just appeared (2 samples @ 8%): old Σpct = 16 → would be DROPPED.
    [6810, [{ time: 200, pct: 8 }, { time: 201, pct: 8 }]],
  ]);
  // Old cumulative ranking hid the 8% wall (the exact live bug: strongest wall, no beads).
  // Peak-bias: 6810 weight 8 > 6800 weight 3 → the strong wall wins the single slot.
  assert.deepEqual(pickActiveStrikes(trails, 1), [6810]);
});

test("mergeWallHistory: unions by bar time so Redis + replica tails combine", () => {
  const local = [{ time: 100, walls: walls([6800], [6700]) }];
  const remote = [
    { time: 100, walls: walls([6805], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
  ];
  const merged = mergeWallHistory(local, remote);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].walls.callWalls[0].strike, 6805);
  assert.equal(merged[1].time, 160);
});

test("mergeWallHistory: keeps local-only bars when remote is shorter", () => {
  const local = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
    { time: 220, walls: walls([6820], [6700]) },
  ];
  const remote = [{ time: 100, walls: walls([6800], [6700]) }];
  assert.equal(mergeWallHistory(local, remote).length, 3);
});

test("trailForGammaFlip: horizontal bead row when flip is present", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]), gammaFlip: 6745 },
    { time: 160, walls: walls([6810], [6700]), gammaFlip: 6750 },
    { time: 220, walls: walls([6810], [6700]), gammaFlip: null },
  ];
  assert.deepEqual(trailForGammaFlip(history), [
    { time: 100, strike: 6745 },
    { time: 160, strike: 6750 },
  ]);
});

test("trailForFlipLevel: vanna flip trail from vexFlip field", () => {
  const history: WallHistorySample[] = [
    {
      time: 100,
      walls: walls([6800], [6700]),
      vexWalls: walls([6820], [6680]),
      vexFlip: 6760,
    },
  ];
  assert.deepEqual(trailForFlipLevel(history, "vex"), [{ time: 100, strike: 6760 }]);
});

test("hasVexInHistory: true when vex walls present", () => {
  assert.equal(
    hasVexInHistory([{ time: 1, walls: walls([6800], []), vexWalls: walls([6820], []) }]),
    true
  );
});

test("trailsByStrike: vex lens reads vexWalls rows", () => {
  const history: WallHistorySample[] = [
    {
      time: 100,
      walls: walls([6800], []),
      vexWalls: walls([6820], []),
    },
    {
      time: 160,
      walls: walls([6810], []),
      vexWalls: walls([6820], []),
    },
  ];
  const vexTrails = trailsByStrike(history, "callWalls", "vex");
  assert.equal(vexTrails.size, 1);
  assert.deepEqual(vexTrails.get(6820)?.map((p) => p.time), [100, 160]);
});

test("trimHistoryForLiveTrails: drops samples older than the lookback window", () => {
  const anchor = 10_000;
  const history: WallHistorySample[] = [
    { time: anchor - LIVE_TRAIL_LOOKBACK_SEC - 60, walls: walls([6700], []) },
    { time: anchor - 120, walls: walls([6800], []) },
    { time: anchor, walls: walls([6810], []) },
  ];
  const trimmed = trimHistoryForLiveTrails(history, LIVE_TRAIL_LOOKBACK_SEC, anchor);
  assert.deepEqual(trimmed.map((s) => s.time), [anchor - 120, anchor]);
});

test("liveTrailAnchorSec: uses the later of wall history tail and last bar", () => {
  assert.equal(liveTrailAnchorSec([{ time: 500, walls: walls([6800], []) }], [100, 700]), 700);
});

test("bucketWallHistoryForInterval: 1m collapses 15s samples to one bead per minute", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 115, walls: walls([6805], [6700]) },
    { time: 130, walls: walls([6810], [6700]) },
    { time: 160, walls: walls([6815], [6705]) },
  ];
  const out = bucketWallHistoryForInterval(history, 1);
  assert.deepEqual(out.map((s) => s.time), [60, 120]);
  assert.equal(out[0]!.walls.callWalls[0]!.strike, 6805);
  assert.equal(out[1]!.walls.callWalls[0]!.strike, 6815);
});

test("bucketWallHistoryForInterval: 5m aligns to five-minute candle buckets", () => {
  const base = 300 * 60;
  const history: WallHistorySample[] = [
    { time: base + 15, walls: walls([6800], []) },
    { time: base + 120, walls: walls([6810], []) },
    { time: base + 300, walls: walls([6820], []) },
    { time: base + 420, walls: walls([6830], []) },
  ];
  const out = bucketWallHistoryForInterval(history, 5);
  assert.deepEqual(out.map((s) => s.time), [base, base + 300]);
  assert.equal(out[0]!.walls.callWalls[0]!.strike, 6810);
  assert.equal(out[1]!.walls.callWalls[0]!.strike, 6830);
});
