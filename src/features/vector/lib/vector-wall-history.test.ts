import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketWallHistoryForInterval,
  liveTrailAnchorSec,
  mergeModeledUnderlay,
  mergeWallHistory,
  narrowedHorizonTrail,
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

test("time-honest rail: a sparse recorded history is passed through untouched, never densified", () => {
  // Product decision 2026-07-11: the rail shows ONLY point-in-time recorded samples.
  // The page previously back-filled a dense full-session rail from the closing chain when
  // the recorded history was sparse (< 8 samples) — a flat, full-width reconstruction that
  // read as "walls everywhere all session". Time-honest means: whatever the recorder captured
  // is exactly what renders. Composing the two building blocks the page uses (mergeWallHistory
  // of recorded rows, then seedWallHistoryForDisplay) must NOT add rows to a non-empty history.
  const recorded: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
  ];
  const base = mergeWallHistory(recorded, []);
  const rail = seedWallHistoryForDisplay(base, [100, 160, 220], walls([6810], [6700]), 6750);
  // Exactly the two recorded samples — no reconstruction padding out to a full-width rail.
  assert.equal(rail.length, 2);
  assert.deepEqual(rail.map((s) => s.time), [100, 160]);
});

test("time-honest rail: an empty history yields exactly one as-of-close snapshot, not a fabricated day", () => {
  const rail = seedWallHistoryForDisplay([], [100, 160, 220], walls([6800], [6700]), 6750);
  assert.equal(rail.length, 1);
  assert.equal(rail[0].time, 220); // the last visible candle — session close, right edge
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

test("mergeModeledUnderlay: an observed sample overwrites the modeled one at a shared bucket", () => {
  const observed: WallHistorySample[] = [{ time: 100, walls: walls([6800], [6700]) }];
  const modeled: WallHistorySample[] = [{ time: 100, walls: walls([6805], [6700]) }];
  const merged = mergeModeledUnderlay(observed, modeled);
  assert.equal(merged.length, 1);
  // Observed wins the bucket: its strike survives and it's tagged modeled:false.
  assert.equal(merged[0].walls.callWalls[0].strike, 6800);
  assert.equal(merged[0].modeled, false);
});

test("mergeModeledUnderlay: modeled fills gap buckets the recorder never observed", () => {
  const observed: WallHistorySample[] = [{ time: 100, walls: walls([6800], [6700]) }];
  const modeled: WallHistorySample[] = [
    { time: 100, walls: walls([6805], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
    { time: 220, walls: walls([6820], [6700]) },
  ];
  const merged = mergeModeledUnderlay(observed, modeled);
  assert.deepEqual(merged.map((s) => [s.time, s.modeled]), [
    [100, false], // observed
    [160, true], // modeled gap-fill
    [220, true], // modeled gap-fill
  ]);
});

test("mergeModeledUnderlay: empty observed → an all-modeled trail", () => {
  const modeled: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
  ];
  const merged = mergeModeledUnderlay([], modeled);
  assert.equal(merged.length, 2);
  assert.ok(merged.every((s) => s.modeled === true));
});

test("mergeModeledUnderlay: empty modeled → all observed, tagged modeled:false", () => {
  const observed: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
  ];
  const merged = mergeModeledUnderlay(observed, []);
  assert.equal(merged.length, 2);
  assert.ok(merged.every((s) => s.modeled === false));
});

test("mergeModeledUnderlay: result is sorted by time regardless of input ordering", () => {
  const observed: WallHistorySample[] = [{ time: 220, walls: walls([6820], [6700]) }];
  const modeled: WallHistorySample[] = [
    { time: 160, walls: walls([6810], [6700]) },
    { time: 100, walls: walls([6800], [6700]) },
  ];
  const merged = mergeModeledUnderlay(observed, modeled);
  assert.deepEqual(merged.map((s) => s.time), [100, 160, 220]);
});

test("mergeModeledUnderlay: caps to MAX_HISTORY by keeping the newest tail", () => {
  // 2100 modeled buckets (> the 1920 cap) → tail-sliced to the most recent 1920.
  const modeled: WallHistorySample[] = Array.from({ length: 2100 }, (_, i) => ({
    time: i * 15,
    walls: walls([6800], [6700]),
  }));
  const merged = mergeModeledUnderlay([], modeled);
  assert.equal(merged.length, 1920);
  assert.equal(merged[0].time, (2100 - 1920) * 15);
  assert.equal(merged[merged.length - 1].time, 2099 * 15);
});

test("trailsByStrike: threads the sample's modeled flag onto each emitted trail point", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], []), modeled: true },
    { time: 160, walls: walls([6800], []) }, // observed (modeled absent)
  ];
  const trail = trailsByStrike(history, "callWalls").get(6800)!;
  assert.deepEqual(
    trail.map((p) => [p.time, p.modeled]),
    [
      [100, true],
      [160, undefined],
    ]
  );
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

test("narrowedHorizonTrail: narrowed GEX horizon → single scoped column; all/vex/empty → blended fallback", () => {
  const scoped = { callWalls: [{ strike: 105, pct: 40 }], putWalls: [{ strike: 95, pct: 30 }] };
  // Narrowed GEX horizon with scoped walls → one point-in-time sample at the last bar.
  const t = narrowedHorizonTrail("0dte", "gex", scoped, 1_700_000_000, 100.5);
  assert.ok(t && t.length === 1, "narrowed → single-sample trail");
  assert.equal(t![0]!.time, 1_700_000_000);
  assert.equal(t![0]!.walls, scoped);
  assert.equal(t![0]!.gammaFlip, 100.5);
  // "all" horizon → null (caller uses the blended recorded rail).
  assert.equal(narrowedHorizonTrail("all", "gex", scoped, 1_700_000_000, 100.5), null);
  // VEX lens has no horizon scope → null.
  assert.equal(narrowedHorizonTrail("weekly", "vex", scoped, 1_700_000_000, 100.5), null);
  // Empty scoped walls → null (never blank the rail on a toggle; fall back to blended).
  assert.equal(narrowedHorizonTrail("weekly", "gex", { callWalls: [], putWalls: [] }, 1_700_000_000, 100.5), null);
  assert.equal(narrowedHorizonTrail("weekly", "gex", null, 1_700_000_000, 100.5), null);
  // No last-bar time → null.
  assert.equal(narrowedHorizonTrail("weekly", "gex", scoped, 0, 100.5), null);
});
