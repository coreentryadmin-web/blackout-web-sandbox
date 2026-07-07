import { test } from "node:test";
import assert from "node:assert/strict";
import { recalcGexWallDistances } from "@/features/spx/lib/spx-desk-merge";

// recalcGexWallDistances is pure; spx-desk-merge.ts is client-safe and its @/ imports
// resolve under tsx --test (tsconfig paths).

const wall = (strike: number, kind: "support" | "resistance") => ({
  strike,
  net_gex: 1,
  kind,
  distance_pts: 0,
});

test("strike above spot => resistance", () => {
  const [w] = recalcGexWallDistances([wall(5500, "support")], 5400);
  assert.equal(w.kind, "resistance");
});

test("strike below spot => support", () => {
  const [w] = recalcGexWallDistances([wall(5300, "resistance")], 5400);
  assert.equal(w.kind, "support");
});

test("crossing flips support -> resistance and distance sign", () => {
  const [w] = recalcGexWallDistances([wall(5450, "support")], 5400);
  assert.equal(w.kind, "resistance");
  assert.ok(w.distance_pts > 0);
});

test("strike === spot => support (matches topGexWalls strike <= spot)", () => {
  const [w] = recalcGexWallDistances([wall(5400, "resistance")], 5400);
  assert.equal(w.kind, "support");
});

test("empty walls or spot<=0 returns input unchanged", () => {
  const input = [wall(5400, "support")];
  assert.deepEqual(recalcGexWallDistances([], 5400), []);
  assert.equal(recalcGexWallDistances(input, 0), input);
});
