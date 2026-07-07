import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGexWalls, mapFromStrikeTotalsRecord, nextWallScope } from "./gex-wall-levels";

test("computeGexWalls picks the largest-positive strike as call wall and largest-negative as put wall", () => {
  const ladder = new Map<number, number>([
    [6700, -1e9],
    [6750, 5e8],
    [6800, 2e9],
    [6850, -5e8],
  ]);
  const { callWall, putWall } = computeGexWalls(ladder);
  assert.equal(callWall?.strike, 6800);
  assert.equal(putWall?.strike, 6700);
});

test("computeGexWalls sizes each wall by its share of total |gamma| across the ladder", () => {
  // |gamma| total = 2e9 (call) + 1e9 (put) = 3e9. Call wall is 2/3, put wall is 1/3.
  const ladder = new Map<number, number>([
    [6800, 2e9],
    [6700, -1e9],
  ]);
  const { callWall, putWall } = computeGexWalls(ladder);
  assert.ok(callWall);
  assert.ok(putWall);
  assert.ok(Math.abs(callWall!.pct - (200 / 3)) < 1e-9);
  assert.ok(Math.abs(putWall!.pct - (100 / 3)) < 1e-9);
});

test("computeGexWalls returns null walls for an empty ladder", () => {
  assert.deepEqual(computeGexWalls(new Map()), { callWall: null, putWall: null });
});

test("computeGexWalls returns a null put wall when every strike is net-positive (no negative extremum)", () => {
  const ladder = new Map<number, number>([
    [6800, 2e9],
    [6850, 5e8],
  ]);
  const { callWall, putWall } = computeGexWalls(ladder);
  assert.equal(callWall?.strike, 6800);
  assert.equal(putWall, null);
});

test("computeGexWalls returns a null call wall when every strike is net-negative (no positive extremum)", () => {
  const ladder = new Map<number, number>([
    [6800, -2e9],
    [6850, -5e8],
  ]);
  const { callWall, putWall } = computeGexWalls(ladder);
  assert.equal(callWall, null);
  assert.equal(putWall?.strike, 6800);
});

test("mapFromStrikeTotalsRecord converts a strike_totals record into the Map computeGexWalls expects", () => {
  const map = mapFromStrikeTotalsRecord({ "6800": 2e9, "6700": -1e9 });
  assert.equal(map.get(6800), 2e9);
  assert.equal(map.get(6700), -1e9);
  const { callWall, putWall } = computeGexWalls(map);
  assert.equal(callWall?.strike, 6800);
  assert.equal(putWall?.strike, 6700);
});

test("mapFromStrikeTotalsRecord drops non-finite keys/values", () => {
  const map = mapFromStrikeTotalsRecord({ "6800": 2e9, garbage: 5e8, "6700": NaN });
  assert.deepEqual([...map.entries()], [[6800, 2e9]]);
});

test("nextWallScope advances the scope when the fetch yields expiries", () => {
  const prev = { expiries: undefined, fetchedAt: 0 };
  const next = nextWallScope(prev, 1000, { near_term_expiries: ["2026-07-07", "2026-07-08"] });
  assert.deepEqual(next, { expiries: ["2026-07-07", "2026-07-08"], fetchedAt: 1000 });
});

test("nextWallScope keeps the previous scope on a scope-free (e.g. emptyHeatmap) result, not undefined", () => {
  const prev = { expiries: ["2026-07-07"], fetchedAt: 1000 };
  const next = nextWallScope(prev, 16000, {}); // emptyHeatmap() omits near_term_expiries entirely
  assert.deepEqual(next, { expiries: ["2026-07-07"], fetchedAt: 16000 });
});

test("nextWallScope keeps the previous scope on a thrown fetch (null result)", () => {
  const prev = { expiries: ["2026-07-07"], fetchedAt: 1000 };
  const next = nextWallScope(prev, 16000, null);
  assert.deepEqual(next, { expiries: ["2026-07-07"], fetchedAt: 16000 });
});

test("nextWallScope keeps the previous scope on an explicitly empty expiries array", () => {
  const prev = { expiries: ["2026-07-07"], fetchedAt: 1000 };
  const next = nextWallScope(prev, 16000, { near_term_expiries: [] });
  assert.deepEqual(next, { expiries: ["2026-07-07"], fetchedAt: 16000 });
});
