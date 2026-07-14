import { test } from "node:test";
import assert from "node:assert/strict";

import { pickNarrowedWallSample, RECORDED_WALL_HORIZONS } from "./vector-narrowed-wall-core";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";

// The narrowed-horizon wall recorder's pure decision core — the fix for the "frozen 0DTE rail".
// Old behaviour dropped the bucket whenever a horizon's per-expiry reconstruction was empty (silent
// skip), so the SPX 0DTE rail advanced ~1/25min. New behaviour FALLS BACK to the blended near-term
// walls so the rail keeps advancing; only a true all-empty read records an honest gap.

const horizonWalls: GexWalls = { callWalls: [{ strike: 7600, pct: 6 }], putWalls: [{ strike: 7495, pct: 2 }] };
const blendedWalls: GexWalls = { callWalls: [{ strike: 7550, pct: 4 }], putWalls: [{ strike: 7500, pct: 3 }] };
const empty: GexWalls = { callWalls: [], putWalls: [] };

test("RECORDED_WALL_HORIZONS covers exactly the three narrowed horizons", () => {
  assert.deepEqual([...RECORDED_WALL_HORIZONS], ["0dte", "weekly", "monthly"]);
});

test("horizon walls present → records the horizon-scoped walls", () => {
  const { sample, source } = pickNarrowedWallSample({
    time: 1000,
    horizonWalls,
    horizonFlip: 7536,
    blendedWalls,
    blendedFlip: 7540,
  });
  assert.equal(source, "horizon");
  assert.ok(sample);
  assert.equal(sample.walls.callWalls[0].strike, 7600);
  assert.equal(sample.gammaFlip, 7536);
});

test("horizon empty → HONEST GAP even when blended walls exist (fallback removed 2026-07-13)", () => {
  // The old blended-fallback recorded the all-day-stable blended ladder INTO narrowed rails —
  // on non-expiry days (TSLA Monday: no 0DTE chain) the entire "0DTE" rail became mislabeled
  // blended data: full-width static trails, no births/deaths (member-caught live). Wrong-scope
  // data is worse than a gap: a bead on a narrowed lens must BE that horizon's structure.
  const { sample, source } = pickNarrowedWallSample({
    time: 1000,
    horizonWalls: empty,
    horizonFlip: null,
    blendedWalls,
    blendedFlip: 7540,
  });
  assert.equal(source, "empty");
  assert.equal(sample, null);
});

test("both empty → honest gap (no sample)", () => {
  const { sample, source } = pickNarrowedWallSample({
    time: 1000,
    horizonWalls: empty,
    horizonFlip: null,
    blendedWalls: null,
    blendedFlip: null,
  });
  assert.equal(source, "empty");
  assert.equal(sample, null);
});

test("null horizon walls (reconstruction failed) → honest gap, never blended", () => {
  const { sample, source } = pickNarrowedWallSample({
    time: 1000,
    horizonWalls: null,
    horizonFlip: null,
    blendedWalls,
    blendedFlip: 7540,
  });
  assert.equal(source, "empty");
  assert.equal(sample, null);
});
