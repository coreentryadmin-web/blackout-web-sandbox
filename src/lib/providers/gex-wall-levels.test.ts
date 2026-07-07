import { test } from "node:test";
import assert from "node:assert/strict";
import { wallsFromStrikeTotals } from "@/lib/providers/gex-cross-validation-core";
import { computeGexWalls, mapFromStrikeTotalsRecord, nextWallScope } from "./gex-wall-levels";

test("computeGexWalls ranks call walls (positive strikes) strongest-first", () => {
  const ladder = new Map<number, number>([
    [6700, -1e9],
    [6750, 5e8],
    [6800, 2e9],
    [6850, -5e8],
  ]);
  const { callWalls, putWalls } = computeGexWalls(ladder);
  assert.deepEqual(callWalls.map((w) => w.strike), [6800, 6750]);
  assert.deepEqual(putWalls.map((w) => w.strike), [6700, 6850]);
});

test("computeGexWalls: the #1 wall per side always matches wallsFromStrikeTotals' single-pick semantics", () => {
  const ladder = new Map<number, number>([
    [6700, -3e9],
    [6710, 1e8],
    [6720, 2e9],
    [6730, -1e8],
  ]);
  const strikeTotals = { "6700": -3e9, "6710": 1e8, "6720": 2e9, "6730": -1e8 };
  const single = wallsFromStrikeTotals(strikeTotals);
  const { callWalls, putWalls } = computeGexWalls(ladder);
  assert.equal(callWalls[0]?.strike, single.callWall);
  assert.equal(putWalls[0]?.strike, single.putWall);
});

test("computeGexWalls sizes each wall by its share of total |gamma| across the ladder", () => {
  // |gamma| total = 2e9 (call) + 1e9 (put) = 3e9. Call wall is 2/3, put wall is 1/3.
  const ladder = new Map<number, number>([
    [6800, 2e9],
    [6700, -1e9],
  ]);
  const { callWalls, putWalls } = computeGexWalls(ladder);
  assert.ok(Math.abs(callWalls[0]!.pct - (200 / 3)) < 1e-9);
  assert.ok(Math.abs(putWalls[0]!.pct - (100 / 3)) < 1e-9);
});

test("computeGexWalls caps each side at maxPerSide, dropping the weakest strikes", () => {
  const ladder = new Map<number, number>([
    [6800, 4e9],
    [6810, 3e9],
    [6820, 2e9],
    [6830, 1e9], // dropped — 4th strongest call strike, cap is 3
  ]);
  const { callWalls } = computeGexWalls(ladder, { maxPerSide: 3 });
  assert.equal(callWalls.length, 3);
  assert.deepEqual(callWalls.map((w) => w.strike), [6800, 6810, 6820]);
});

test("computeGexWalls defaults to 3 nodes per side when maxPerSide is omitted", () => {
  const ladder = new Map<number, number>([
    [1, 5e9],
    [2, 4e9],
    [3, 3e9],
    [4, 2e9],
    [5, 1e9],
  ]);
  const { callWalls } = computeGexWalls(ladder);
  assert.equal(callWalls.length, 3);
});

test("computeGexWalls returns empty arrays for an empty ladder", () => {
  assert.deepEqual(computeGexWalls(new Map()), { callWalls: [], putWalls: [] });
});

test("computeGexWalls returns an empty put side when every strike is net-positive", () => {
  const ladder = new Map<number, number>([
    [6800, 2e9],
    [6850, 5e8],
  ]);
  const { callWalls, putWalls } = computeGexWalls(ladder);
  assert.equal(callWalls[0]?.strike, 6800);
  assert.deepEqual(putWalls, []);
});

test("computeGexWalls returns an empty call side when every strike is net-negative", () => {
  const ladder = new Map<number, number>([
    [6800, -2e9],
    [6850, -5e8],
  ]);
  const { callWalls, putWalls } = computeGexWalls(ladder);
  assert.deepEqual(callWalls, []);
  assert.equal(putWalls[0]?.strike, 6800);
});

test("mapFromStrikeTotalsRecord converts a strike_totals record into the Map computeGexWalls expects", () => {
  const map = mapFromStrikeTotalsRecord({ "6800": 2e9, "6700": -1e9 });
  assert.equal(map.get(6800), 2e9);
  assert.equal(map.get(6700), -1e9);
  const { callWalls, putWalls } = computeGexWalls(map);
  assert.equal(callWalls[0]?.strike, 6800);
  assert.equal(putWalls[0]?.strike, 6700);
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
