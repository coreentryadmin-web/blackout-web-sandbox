import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendVectorWallEvents,
  detectSpotStructureEvents,
  diffVectorWallSample,
  eventsFromWallHistory,
} from "./vector-wall-events";
import type { WallHistorySample } from "./vector-wall-history";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";

function walls(call: number, put: number): GexWalls {
  return {
    callWalls: [{ strike: call, pct: 12 }],
    putWalls: [{ strike: put, pct: 10 }],
  };
}

test("diffVectorWallSample: detects call wall migration", () => {
  const prev: WallHistorySample = { time: 100, walls: walls(6800, 6700) };
  const next: WallHistorySample = { time: 115, walls: walls(6810, 6700) };
  const events = diffVectorWallSample(prev, next, "gex");
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, "call_wall_shift");
  assert.match(events[0]!.message, /6,800/);
  assert.match(events[0]!.message, /6,810/);
});

test("diffVectorWallSample: vex lens reads vexWalls", () => {
  const prev: WallHistorySample = {
    time: 100,
    walls: walls(6800, 6700),
    vexWalls: walls(6820, 6680),
    vexFlip: 6760,
  };
  const next: WallHistorySample = {
    time: 115,
    walls: walls(6800, 6700),
    vexWalls: walls(6830, 6680),
    vexFlip: 6770,
  };
  const events = diffVectorWallSample(prev, next, "vex");
  assert.equal(events.some((e) => e.kind === "call_wall_shift"), true);
  assert.equal(events.some((e) => e.kind === "flip_shift"), true);
});

test("detectSpotStructureEvents: flip cross warns on breakdown", () => {
  const events = detectSpotStructureEvents(6760, 6740, walls(6800, 6700), 6750, "gex", 200);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, "spot_crossed_flip");
  assert.equal(events[0]!.severity, "warn");
});

test("detectSpotStructureEvents: call wall break", () => {
  const events = detectSpotStructureEvents(6795, 6805, walls(6800, 6700), null, "gex", 200);
  assert.equal(events[0]!.kind, "spot_broke_call");
});

test("eventsFromWallHistory: unions shifts across session", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls(6800, 6700) },
    { time: 115, walls: walls(6810, 6700) },
    { time: 130, walls: walls(6810, 6690) },
  ];
  const events = eventsFromWallHistory(history, "gex");
  assert.equal(events.length, 2);
});

test("appendVectorWallEvents: caps tail", () => {
  let events = appendVectorWallEvents([], [
    { time: 1, lens: "gex", kind: "flip_shift", message: "a", severity: "info" },
  ]);
  for (let i = 0; i < 20; i++) {
    events = appendVectorWallEvents(events, [
      { time: i, lens: "gex", kind: "flip_shift", message: `m${i}`, severity: "info" },
    ]);
  }
  assert.equal(events.length, 12);
});

// ---- 2026-07-11 wall-event integrity hardening ----

test("diffVectorWallSample: same-bucket re-observation (equal times) emits nothing", () => {
  const prev: WallHistorySample = { time: 100, walls: walls(6800, 6700) };
  const next: WallHistorySample = { time: 100, walls: walls(6810, 6700) };
  assert.equal(diffVectorWallSample(prev, next, "gex").length, 0);
});

test("diffVectorWallSample: a discontinuity gap (reconnect/tab sleep) emits nothing", () => {
  const prev: WallHistorySample = { time: 100, walls: walls(6800, 6700) };
  const next: WallHistorySample = { time: 100 + 3600, walls: walls(6900, 6600) };
  assert.equal(
    diffVectorWallSample(prev, next, "gex").length,
    0,
    "diffing across an hour-long gap fabricates a shift timestamped now for an unobserved change"
  );
});

test("diffVectorWallSample: sub-point flip drift does not fabricate 'flip moved 6,745 → 6,745'", () => {
  const prev: WallHistorySample = { time: 100, walls: walls(6800, 6700), gammaFlip: 6745.3333333 };
  const next: WallHistorySample = { time: 115, walls: walls(6800, 6700), gammaFlip: 6745.33 };
  assert.equal(
    diffVectorWallSample(prev, next, "gex").length,
    0,
    "raw-float flip comparison fires on precision deltas the rounded message cannot even display"
  );
});

test("diffVectorWallSample: a genuinely moved flip still emits", () => {
  const prev: WallHistorySample = { time: 100, walls: walls(6800, 6700), gammaFlip: 6745 };
  const next: WallHistorySample = { time: 115, walls: walls(6800, 6700), gammaFlip: 6752 };
  const events = diffVectorWallSample(prev, next, "gex");
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, "flip_shift");
});

test("diffVectorWallSample: rank-1/rank-2 near-tie flapping is suppressed; dominant shifts emit", () => {
  const nearTie: GexWalls = {
    callWalls: [
      { strike: 6810, pct: 12.4 }, // new top…
      { strike: 6800, pct: 12.1 }, // …but old top is right behind — noise
    ],
    putWalls: [{ strike: 6700, pct: 10 }],
  };
  const prev: WallHistorySample = { time: 100, walls: walls(6800, 6700) };
  const flapped: WallHistorySample = { time: 115, walls: nearTie };
  assert.equal(
    diffVectorWallSample(prev, flapped, "gex").filter((e) => e.kind === "call_wall_shift").length,
    0,
    "near-tie rank swap must not spam SHIFT events"
  );

  const dominant: GexWalls = {
    callWalls: [
      { strike: 6810, pct: 22 },
      { strike: 6800, pct: 9 },
    ],
    putWalls: [{ strike: 6700, pct: 10 }],
  };
  const shifted: WallHistorySample = { time: 115, walls: dominant };
  assert.equal(
    diffVectorWallSample(prev, shifted, "gex").filter((e) => e.kind === "call_wall_shift").length,
    1,
    "a decisive concentration move must still emit"
  );
});

test("detectSpotStructureEvents: a wall relocating across a FLAT spot is not a breakout", () => {
  // spot barely moves 6800.2 → 6800.4; one bad snapshot moves the call wall
  // from 6810 down to 6800.3 — the level crossed the spot, not vice versa.
  const prevWalls = walls(6810, 6700);
  const curWalls = walls(6800, 6700); // topStrike rounds 6800.3 → 6800
  const events = detectSpotStructureEvents(
    6800.2, 6800.4, curWalls, null, "gex", 500, prevWalls, null
  );
  assert.equal(
    events.filter((e) => e.kind === "spot_broke_call").length,
    0,
    "level instability must suppress the break"
  );
});

test("detectSpotStructureEvents: spot crossing a STABLE wall still emits a break", () => {
  const stable = walls(6800, 6700);
  const events = detectSpotStructureEvents(
    6799.5, 6800.6, stable, null, "gex", 500, stable, null
  );
  assert.equal(events.filter((e) => e.kind === "spot_broke_call").length, 1);
});

test("detectSpotStructureEvents: without prev structure (legacy callers) behavior is unchanged", () => {
  const events = detectSpotStructureEvents(6799.5, 6800.6, walls(6800, 6700), null, "gex", 500);
  assert.equal(events.filter((e) => e.kind === "spot_broke_call").length, 1);
});

test("detectSpotStructureEvents: flip cross requires a stable flip when prev provided", () => {
  const moved = detectSpotStructureEvents(6740, 6750, null, 6745, "gex", 500, null, 6760);
  assert.equal(moved.length, 0, "flip relocated across spot — not a member-actionable cross");
  const stable = detectSpotStructureEvents(6740, 6750, null, 6745, "gex", 500, null, 6745.2);
  assert.equal(stable.length, 1, "sub-point flip jitter still counts as stable");
});

// ── Strength-dynamics narration: building / fading / new / dissolved ──────────────
function ladder(callLevels: Array<[number, number]>, putLevels: Array<[number, number]>): GexWalls {
  return {
    callWalls: callLevels.map(([strike, pct]) => ({ strike, pct })),
    putWalls: putLevels.map(([strike, pct]) => ({ strike, pct })),
  };
}

test("dynamics: a held call wall gaining gamma share emits a BUILDING event", () => {
  const prev: WallHistorySample = { time: 100, walls: ladder([[6800, 5]], [[6700, 6]]) };
  const next: WallHistorySample = { time: 115, walls: ladder([[6800, 9]], [[6700, 6]]) };
  const ev = diffVectorWallSample(prev, next, "gex").find((e) => e.kind === "call_wall_building");
  assert.ok(ev, "expected a call_wall_building event");
  assert.match(ev!.message, /building — 5% → 9%/);
});

test("dynamics: a held wall losing gamma share emits a FADING event", () => {
  const prev: WallHistorySample = { time: 100, walls: ladder([[6800, 10]], [[6700, 6]]) };
  const next: WallHistorySample = { time: 115, walls: ladder([[6800, 5]], [[6700, 6]]) };
  const ev = diffVectorWallSample(prev, next, "gex").find((e) => e.kind === "call_wall_fading");
  assert.ok(ev, "expected a call_wall_fading event");
  assert.match(ev!.message, /fading — 10% → 5%/);
});

test("dynamics: a strike newly crossing the material threshold emits a NEW event", () => {
  const prev: WallHistorySample = { time: 100, walls: ladder([[6800, 8]], [[6700, 6]]) };
  const next: WallHistorySample = { time: 115, walls: ladder([[6800, 8], [6850, 6]], [[6700, 6]]) };
  const ev = diffVectorWallSample(prev, next, "gex").find((e) => e.kind === "call_wall_new");
  assert.ok(ev, "expected a call_wall_new event");
  assert.match(ev!.message, /New call wall forming at 6,850 \(6% gamma\)/);
});

test("dynamics: a material wall leaving the board emits a DISSOLVED event", () => {
  const prev: WallHistorySample = { time: 100, walls: ladder([[6800, 8], [6750, 7]], [[6700, 6]]) };
  const next: WallHistorySample = { time: 115, walls: ladder([[6800, 8]], [[6700, 6]]) };
  const ev = diffVectorWallSample(prev, next, "gex").find((e) => e.kind === "call_wall_gone");
  assert.ok(ev, "expected a call_wall_gone event");
  assert.match(ev!.message, /6,750 dissolved — was 7% gamma/);
});

test("dynamics: a sub-threshold wobble (<3pp) emits nothing", () => {
  const prev: WallHistorySample = { time: 100, walls: ladder([[6800, 7]], [[6700, 6]]) };
  const next: WallHistorySample = { time: 115, walls: ladder([[6800, 8]], [[6700, 6]]) };
  assert.deepEqual(diffVectorWallSample(prev, next, "gex"), []);
});

test("dynamics: a new strike below the material floor (<4%) is ignored (noise)", () => {
  const prev: WallHistorySample = { time: 100, walls: ladder([[6800, 8]], [[6700, 6]]) };
  const next: WallHistorySample = { time: 115, walls: ladder([[6800, 8], [6860, 2]], [[6700, 6]]) };
  assert.deepEqual(diffVectorWallSample(prev, next, "gex"), []);
});

test("dynamics: a top-wall SHIFT suppresses redundant new/gone on the same strikes", () => {
  // 6800 (9%) -> 6810 (9%) as the dominant call: a shift, not two separate new/gone lines.
  const prev: WallHistorySample = { time: 100, walls: ladder([[6800, 9]], [[6700, 6]]) };
  const next: WallHistorySample = { time: 115, walls: ladder([[6810, 9]], [[6700, 6]]) };
  const ev = diffVectorWallSample(prev, next, "gex");
  assert.deepEqual(ev.map((e) => e.kind), ["call_wall_shift"]);
});
