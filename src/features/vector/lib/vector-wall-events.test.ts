import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendVectorWallEvents,
  detectSpotStructureEvents,
  diffVectorWallSample,
  eventsFromWallHistory,
} from "./vector-wall-events";
import type { WallHistorySample } from "./vector-wall-history";
import type { GexWalls } from "./gex-wall-levels";

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
