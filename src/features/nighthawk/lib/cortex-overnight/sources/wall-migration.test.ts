import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveWallMigrationEvidence,
  wallSlopePctPerDay,
  WALL_PATH_OPPOSE_WEIGHT,
  WALL_BUILDING_OPPOSE_WEIGHT,
} from "./wall-migration";
import type { OvernightInputs, OvernightWallSlice, OvernightWallSample } from "../types";

function input(wall: OvernightWallSlice | null, direction: "long" | "short" = "long"): OvernightInputs {
  return {
    ticker: "AMD",
    direction,
    now: "2026-07-14T21:00:00Z",
    horizonDate: "2026-07-15",
    catalyst: null,
    wall,
    darkPool: null,
    iv: null,
    sector: null,
    flow: null,
    errors: {},
  };
}

function wall(over: Partial<OvernightWallSlice> = {}): OvernightWallSlice {
  return {
    asOf: "2026-07-14T21:00:00Z",
    spot: 160,
    gammaFlip: 158,
    regime: "long",
    opposingWall: { strike: 165, kind: "call" },
    target: 170, // beyond the 165 call wall ⇒ path blocked
    samples: [],
    ...over,
  };
}

test("wall-migration: LONG target beyond the call wall is an oppose (fighting dealer structure)", () => {
  const items = deriveWallMigrationEvidence(input(wall()));
  const oppose = items.find((i) => i.stance === "opposes");
  assert.ok(oppose);
  assert.equal(oppose!.weight, WALL_PATH_OPPOSE_WEIGHT);
  assert.match(oppose!.detail, /runs through dealer structure/);
});

test("wall-migration: LONG target short of the call wall is a support (clear path)", () => {
  const items = deriveWallMigrationEvidence(input(wall({ target: 163 })));
  assert.ok(items.some((i) => i.stance === "supports"));
  assert.ok(!items.some((i) => i.stance === "opposes"));
});

test("wall-migration: a BUILDING opposing wall in the path stacks a second, heavier oppose", () => {
  const samples: OvernightWallSample[] = [
    { time: 1_000_000, opposingWallPct: 10 },
    { time: 1_086_400, opposingWallPct: 16 },
    { time: 1_172_800, opposingWallPct: 22 },
    { time: 1_259_200, opposingWallPct: 28 }, // rising ~6 pct-pts/day
  ];
  const items = deriveWallMigrationEvidence(input(wall({ samples })));
  const opposes = items.filter((i) => i.stance === "opposes");
  assert.equal(opposes.length, 2, "path-block + building");
  assert.ok(opposes.some((o) => o.weight === WALL_BUILDING_OPPOSE_WEIGHT));
  assert.ok(opposes.some((o) => /HARDENING/.test(o.detail)));
});

test("wall-migration: SHORT target below the put wall is an oppose", () => {
  const w = wall({ opposingWall: { strike: 155, kind: "put" }, target: 150, spot: 160 });
  const items = deriveWallMigrationEvidence(input(w, "short"));
  assert.ok(items.some((i) => i.stance === "opposes"));
});

test("wall-migration: fail-soft — no wall slice / no opposing wall is absent", () => {
  assert.equal(deriveWallMigrationEvidence(input(null))[0].stance, "absent");
  assert.equal(deriveWallMigrationEvidence(input(wall({ opposingWall: null })))[0].stance, "absent");
});

test("wall-migration: spot null renders 'n/a' in the narrative, path check still works", () => {
  const items = deriveWallMigrationEvidence(input(wall({ spot: null })));
  assert.ok(items.some((i) => i.stance === "opposes"));
  assert.match(items[0].detail, /spot n\/a/);
});

test("wallSlopePctPerDay: positive slope for a rising rail, null for <2 points", () => {
  assert.ok((wallSlopePctPerDay([
    { time: 0, opposingWallPct: 10 },
    { time: 86_400, opposingWallPct: 20 },
  ]) as number) > 0);
  assert.equal(wallSlopePctPerDay([{ time: 0, opposingWallPct: 10 }]), null);
});
