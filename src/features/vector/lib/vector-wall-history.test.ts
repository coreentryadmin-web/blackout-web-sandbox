import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backfillRailPrefix,
  bucketWallHistoryForInterval,
  composeHorizonTrail,
  decimateWallHistory,
  isRebirthGap,
  latestSessionSlice,
  liveTrailAnchorSec,
  pickReplayTrailSource,
  mergeModeledUnderlay,
  mergeWallHistory,
  narrowedHorizonTrail,
  pickActiveStrikes,
  recordWallSample,
  seedWallHistoryForDisplay,
  SESSION_GAP_SEC,
  strikeTrailLifecycle,
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
  // Cap is 4800 (multi-day: 14 decimated prior sessions + one full-res latest + headroom).
  let history: WallHistorySample[] = [];
  for (let i = 0; i < 5000; i++) {
    history = recordWallSample(history, { time: i * 15, walls: walls([6800], [6700]) });
  }
  assert.equal(history.length, 4800);
  assert.equal(history[0].time, 200 * 15);
  assert.equal(history[history.length - 1].time, 4999 * 15);
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

test("backfillRailPrefix: fills only the pre-view gap with modeled ghosts; observed stays solid", () => {
  // Member opened the ticker mid-session: observed rail starts at 14:00 (t=50400 rel), bars start
  // at the open (t=0 rel). Model covers the whole session at 5-min cadence.
  const observed = [
    { time: 50400, walls: walls([100], [90]) },
    { time: 50700, walls: walls([100], [90]) },
  ];
  const modeled = [0, 300, 50100, 50400, 50700].map((time) => ({ time, walls: walls([101], [89]) }));
  const merged = backfillRailPrefix(observed, modeled, 0);
  // Prefix modeled buckets (< 50400) included as modeled:true; the modeled 50400/50700 buckets are
  // NOT allowed to overlap/extend the observed region.
  assert.deepEqual(merged.map((s) => s.time), [0, 300, 50100, 50400, 50700]);
  assert.equal(merged[0].modeled, true);
  assert.equal(merged[2].modeled, true);
  assert.equal(merged[3].modeled, false);
  assert.deepEqual(merged[3].walls, walls([100], [90]), "observed sample untouched");
});

test("backfillRailPrefix: no-op when observed already starts near the open, model empty, or no bars", () => {
  const observed = [{ time: 600, walls: walls([100], [90]) }];
  const modeled = [{ time: 0, walls: walls([101], [89]) }];
  assert.equal(backfillRailPrefix(observed, modeled, 0), observed, "gap ≤ 20min → untouched");
  assert.equal(backfillRailPrefix(observed, [], 0), observed, "empty model → untouched");
  assert.equal(backfillRailPrefix(observed, modeled, undefined), observed, "no bars → untouched");
  // Empty observed rail: the whole modeled session becomes the (ghost) rail.
  const seeded = backfillRailPrefix([], [{ time: 0, walls: walls([101], [89]) }, { time: 300, walls: walls([101], [89]) }], 0);
  assert.deepEqual(seeded.map((s) => [s.time, s.modeled]), [[0, true], [300, true]]);
});

test("trailsByStrike: a strike earns beads ONLY in buckets where it is a DOMINANT wall (birth ≠ session open)", () => {
  // The recorder stores a wide ladder (up to 20/side). 6900 sits at the BOTTOM of that ladder for
  // the first two buckets (rank 8 → below the top-6 dominant cut), then becomes the #1 wall. Its
  // trail must START when it became dominant (220), not at the open just because it was a minor
  // ladder member since 100 — the "SPX had the same walls all day" fix.
  const wide = (strikes: number[]): GexWalls => ({
    callWalls: strikes.map((strike, i) => ({ strike, pct: 10 - i })),
    putWalls: [],
  });
  const early = wide([7000, 6990, 6980, 6970, 6960, 6950, 6940, 6900]); // 6900 is rank 8 (excluded)
  const late = wide([6900, 7000, 6990, 6970, 6960, 6950]); // 6900 now rank 1 (dominant)
  const history: WallHistorySample[] = [
    { time: 100, walls: early },
    { time: 160, walls: early },
    { time: 220, walls: late },
  ];
  const trails = trailsByStrike(history, "callWalls");
  // Born at 220 (became dominant), NOT 100 — the whole point of the fix.
  assert.deepEqual(trails.get(6900)?.map((p) => p.time), [220]);
  // A genuinely persistent top wall still runs full-width (correct — it WAS a wall all session).
  assert.deepEqual(trails.get(7000)?.map((p) => p.time), [100, 160, 220]);
  // 6940 was only ever rank 7 (below the cut) then dropped out → no trail at all.
  assert.equal(trails.has(6940), false);
  // Lifecycle carries the honest birth through.
  const life = new Map(strikeTrailLifecycle(history, "callWalls").map((t) => [t.strike, t]));
  assert.equal(life.get(6900)?.bornAt, 220);
});

test("strikeTrailLifecycle: a late-appearing strike is birth-anchored, a departed one stops", () => {
  // 6800 is a wall in the first two buckets then drops out; 6810 only appears in the last two.
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], []) },
    { time: 160, walls: walls([6800], []) },
    { time: 220, walls: walls([6810], []) },
    { time: 280, walls: walls([6810], []) },
  ];
  const life = strikeTrailLifecycle(history, "callWalls");
  const byStrike = new Map(life.map((t) => [t.strike, t]));

  const late = byStrike.get(6810)!;
  // Birth-anchored: markers begin at first appearance (220), NOT back-filled to the open (100).
  assert.deepEqual(late.points.map((p) => p.time), [220, 280]);
  assert.equal(late.bornAt, 220);
  assert.equal(late.active, true); // still in the latest bucket → currently forming/holding

  const departed = byStrike.get(6800)!;
  // A wall that left the set stops at its last bucket (160) and is flagged inactive → the marker
  // layer fades it instead of persisting a full-width rail.
  assert.deepEqual(departed.points.map((p) => p.time), [100, 160]);
  assert.equal(departed.lastSeen, 160);
  assert.equal(departed.active, false);
});

test("strikeTrailLifecycle: active is per-side — a put present at the latest bucket stays active", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 160, walls: walls([6810], [6700]) }, // call migrated, put 6700 held through latest bucket
  ];
  const puts = new Map(strikeTrailLifecycle(history, "putWalls").map((t) => [t.strike, t]));
  assert.equal(puts.get(6700)!.active, true);
  assert.equal(puts.get(6700)!.bornAt, 100);
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
  // 5100 modeled buckets (> the 4800 multi-day cap) → tail-sliced to the most recent 4800.
  const modeled: WallHistorySample[] = Array.from({ length: 5100 }, (_, i) => ({
    time: i * 15,
    walls: walls([6800], [6700]),
  }));
  const merged = mergeModeledUnderlay([], modeled);
  assert.equal(merged.length, 4800);
  assert.equal(merged[0].time, (5100 - 4800) * 15);
  assert.equal(merged[merged.length - 1].time, 5099 * 15);
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

test("pickReplayTrailSource: narrowed GEX horizon replays the recorded trail; else the blended rail", () => {
  const w = walls([105], [95]);
  const recorded: WallHistorySample[] = [
    { time: 1_700_000_000, walls: w, gammaFlip: 100 },
    { time: 1_700_000_900, walls: w, gammaFlip: 100 },
  ];
  const blended: WallHistorySample[] = [{ time: 1_700_000_500, walls: w, gammaFlip: 99 }];

  // Narrowed GEX horizon with a recorded trail → replay THAT trail (not the blended "All" rail).
  assert.equal(pickReplayTrailSource("weekly", "gex", recorded, blended), recorded);
  assert.equal(pickReplayTrailSource("0dte", "gex", recorded, blended), recorded);

  // "all" → always the blended rail (no per-horizon recording for "all").
  assert.equal(pickReplayTrailSource("all", "gex", recorded, blended), blended);
  // VEX lens → blended (per-horizon rails are GEX-only).
  assert.equal(pickReplayTrailSource("weekly", "vex", recorded, blended), blended);
  // Narrowed horizon but nothing recorded yet → blended fallback (replay never blanks).
  assert.equal(pickReplayTrailSource("weekly", "gex", [], blended), blended);
  assert.equal(pickReplayTrailSource("monthly", "gex", null, blended), blended);
});

test("composeHorizonTrail: recorded per-horizon trail preferred, current column unioned in", () => {
  const w = walls([105], [95]);
  const recorded: WallHistorySample[] = [
    { time: 1_700_000_000, walls: w, gammaFlip: 100 },
    { time: 1_700_000_900, walls: w, gammaFlip: 100 },
  ];
  const current: WallHistorySample[] = [{ time: 1_700_001_800, walls: w, gammaFlip: 101 }];

  // Recorded + current → the frozen clusters plus the newest live column, unioned by time.
  const both = composeHorizonTrail(recorded, current);
  assert.ok(both && both.length === 3, "recorded (2) + fresher current column (1) → 3 buckets");
  assert.equal(both![both!.length - 1]!.time, 1_700_001_800, "newest bucket is the current column");

  // Current column at a time the recorder already wrote → overwrites, never duplicates.
  const overlap: WallHistorySample[] = [{ time: 1_700_000_900, walls: w, gammaFlip: 102 }];
  const merged = composeHorizonTrail(recorded, overlap);
  assert.equal(merged!.length, 2, "same-bucket current column overwrites, not appends");
  assert.equal(merged![1]!.gammaFlip, 102, "current column wins its bucket");

  // No recorded trail → fall back to the single current column (pre-recording behaviour).
  assert.deepEqual(composeHorizonTrail([], current), current);
  assert.deepEqual(composeHorizonTrail(null, current), current);

  // Recorded only (e.g. after close, no live column) → the frozen recorded trail as-is.
  assert.equal(composeHorizonTrail(recorded, null), recorded);
  assert.equal(composeHorizonTrail(recorded, []), recorded);

  // Neither → null so the caller draws the blended "All" rail (beads never blank on a toggle).
  assert.equal(composeHorizonTrail([], []), null);
  assert.equal(composeHorizonTrail(null, null), null);
});

// ── Multi-day rail (15-session replay seed) ─────────────────────────────────────────────────

// Two sessions ~1 day apart in epoch seconds (well over SESSION_GAP_SEC).
const DAY = 24 * 60 * 60;
const S1 = 1_000_800; // "yesterday" open-ish (multiple of 120 so bucket math below is exact)
const S2 = S1 + DAY;

test("decimateWallHistory: keeps the LAST sample of each step bucket so wall deaths survive", () => {
  const history: WallHistorySample[] = [
    // Bucket [0,120): wall stands at :00 but has DIED by :105 — the death must survive.
    { time: S1 + 0, walls: walls([6800], [6700]) },
    { time: S1 + 105, walls: walls([], [6700]) },
    // Bucket [120,240): only one sample.
    { time: S1 + 130, walls: walls([6810], [6700]) },
  ];
  const out = decimateWallHistory(history, 120);
  assert.equal(out.length, 2);
  // Last-in-bucket wins: the 6800 call wall is GONE in the surviving sample.
  assert.equal(out[0].time, S1 + 105);
  assert.equal(out[0].walls.callWalls.length, 0);
  assert.equal(out[1].time, S1 + 130);
});

test("decimateWallHistory: preserves modeled flags and original sample times", () => {
  const history: WallHistorySample[] = [
    { time: S1 + 10, walls: walls([6800], []), modeled: true },
    { time: S1 + 20, walls: walls([6805], []), modeled: true },
    { time: S1 + 130, walls: walls([6810], []) },
  ];
  const out = decimateWallHistory(history, 120);
  assert.deepEqual(out.map((s) => s.time), [S1 + 20, S1 + 130]);
  assert.equal(out[0].modeled, true);
  assert.equal(out[1].modeled, undefined);
});

test("decimateWallHistory: maxLevelsPerSide keeps the strongest levels in recorded order", () => {
  const sample: WallHistorySample = {
    time: S1,
    // Strike-ordered ladder with pct 10,9,8,7 (calls) / 8,7 (puts).
    walls: walls([6800, 6810, 6820, 6830], [6700, 6690]),
    vexWalls: walls([6805, 6815, 6825], [6695]),
  };
  const out = decimateWallHistory([sample], 120, { maxLevelsPerSide: 2 });
  assert.equal(out.length, 1);
  // Top-2 by |pct| are the FIRST two here (pct descends with index in the fixture), and the
  // recorded order is preserved (filter, not re-sort).
  assert.deepEqual(out[0].walls.callWalls.map((w) => w.strike), [6800, 6810]);
  assert.deepEqual(out[0].walls.putWalls.map((w) => w.strike), [6700, 6690]);
  assert.deepEqual(out[0].vexWalls!.callWalls.map((w) => w.strike), [6805, 6815]);
  // Input sample untouched (pure).
  assert.equal(sample.walls.callWalls.length, 4);
});

test("decimateWallHistory: a 15s-cadence session decimated to 2min lands near the sample budget", () => {
  // Full RTH session at 15s cadence = 1560 samples → ~195 at the 2-min step.
  const full: WallHistorySample[] = Array.from({ length: 1560 }, (_, i) => ({
    time: S1 + i * 15,
    walls: walls([6800], [6700]),
  }));
  const out = decimateWallHistory(full, 120);
  assert.equal(out.length, 195);
});

test("latestSessionSlice: returns only the samples after the last session-sized gap", () => {
  const history: WallHistorySample[] = [
    { time: S1, walls: walls([6800], [6700]) },
    { time: S1 + 60, walls: walls([6800], [6700]) },
    { time: S2, walls: walls([6900], [6800]) },
    { time: S2 + 60, walls: walls([6900], [6800]) },
  ];
  const latest = latestSessionSlice(history);
  assert.deepEqual(latest.map((s) => s.time), [S2, S2 + 60]);
});

test("latestSessionSlice: single-session history returns unchanged (same reference)", () => {
  const history: WallHistorySample[] = [
    { time: S1, walls: walls([6800], [6700]) },
    { time: S1 + 6 * 60 * 60, walls: walls([6810], [6700]) }, // 6h intraday span < 8h gap
  ];
  assert.equal(latestSessionSlice(history), history);
});

test("isRebirthGap: intraday gap over 2 intervals is a rebirth; an overnight gap is NOT", () => {
  assert.equal(isRebirthGap(60, 60), false, "1 interval — jitter, not a death");
  assert.equal(isRebirthGap(121, 60), true, "intraday death + re-form");
  assert.equal(isRebirthGap(SESSION_GAP_SEC, 60), false, "session boundary — market closure");
  assert.equal(isRebirthGap(17.5 * 60 * 60, 60), false, "real overnight close→open gap");
});

test("trailsByStrike: dominance filter applies per bucket independently across two sessions", () => {
  // Session 1: 6800 dominates. Session 2: 6900 dominates; 6800 has faded to a minor member
  // that must NOT earn a bead in session 2 (top-1 dominance per bucket).
  const history: WallHistorySample[] = [
    {
      time: S1,
      walls: { callWalls: [{ strike: 6800, pct: 10 }, { strike: 6900, pct: 2 }], putWalls: [] },
    },
    {
      time: S2,
      walls: { callWalls: [{ strike: 6800, pct: 1 }, { strike: 6900, pct: 9 }], putWalls: [] },
    },
  ];
  const trails = trailsByStrike(history, "callWalls", "gex", 1);
  assert.deepEqual(trails.get(6800)!.map((p) => p.time), [S1], "6800 beads only in session 1");
  assert.deepEqual(trails.get(6900)!.map((p) => p.time), [S2], "6900 beads only in session 2");
});

test("trailsByStrike: a persistent strike's trail has NO points inside the overnight gap (no bridge)", () => {
  const history: WallHistorySample[] = [
    { time: S1, walls: walls([6800], []) },
    { time: S1 + 60, walls: walls([6800], []) },
    { time: S2, walls: walls([6800], []) },
  ];
  const pts = trailsByStrike(history, "callWalls").get(6800)!;
  // Exactly the sampled buckets — nothing interpolated across the ~24h boundary.
  assert.deepEqual(pts.map((p) => p.time), [S1, S1 + 60, S2]);
});

test("bucketWallHistoryForInterval: multi-day input keeps sessions in distinct buckets", () => {
  const history: WallHistorySample[] = [
    { time: S1, walls: walls([6800], []) },
    { time: S1 + 30, walls: walls([6805], []) },
    { time: S2, walls: walls([6900], []) },
  ];
  const out = bucketWallHistoryForInterval(history, 5);
  assert.equal(out.length, 2, "session-1 pair collapses to one 5m bucket; session 2 stays its own");
  assert.ok(out[1].time - out[0].time >= DAY - 300, "buckets never merge across the day gap");
  assert.equal(out[0].walls.callWalls[0].strike, 6805, "last reading in the bucket wins");
});

test("backfillRailPrefix: multi-day observed rail — prefix measured against the LATEST session window", () => {
  const observed: WallHistorySample[] = [
    { time: S1, walls: walls([6800], []) }, // prior-day sample, long before latestStart
    { time: S2 + 3600, walls: walls([6900], []) }, // today's first observed, 1h after the open
  ];
  const modeled: WallHistorySample[] = [
    { time: S2 + 600, walls: walls([6890], []) }, // inside today's pre-view gap
    { time: S1 + 600, walls: walls([6790], []) }, // PRIOR session — must never be underlaid
  ];
  const merged = backfillRailPrefix(observed, modeled, S2);
  assert.deepEqual(
    merged.map((s) => s.time),
    [S1, S2 + 600, S2 + 3600],
    "prior-day modeled sample excluded; today's gap filled"
  );
  assert.equal(merged[1].modeled, true);
  assert.equal(merged[2].modeled, false);
});

test("backfillRailPrefix: multi-day observed with today's rail starting at the open → no-op", () => {
  const observed: WallHistorySample[] = [
    { time: S1, walls: walls([6800], []) },
    { time: S2 + 60, walls: walls([6900], []) }, // today's rail starts ~at the open
  ];
  const modeled: WallHistorySample[] = [{ time: S2 + 30, walls: walls([6890], []) }];
  assert.equal(backfillRailPrefix(observed, modeled, S2), observed);
});
