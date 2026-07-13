import { test } from "node:test";
import assert from "node:assert/strict";
import {
  heatmapCellColor,
  bandEdges,
  heatmapRects,
  HEATMAP_TRANSPARENT,
} from "./vector-gex-heatmap-paint";
import type { GexHeatmapGrid } from "./vector-gex-reconstruct";

function rgba(s: string): { r: number; g: number; b: number; a: number } {
  const m = s.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  assert.ok(m, `parseable rgba: ${s}`);
  return { r: +m![1]!, g: +m![2]!, b: +m![3]!, a: +m![4]! };
}

test("heatmapCellColor: call cells cyan-positive, put cells magenta-negative", () => {
  const call = rgba(heatmapCellColor(50, 100));
  const put = rgba(heatmapCellColor(-50, 100));
  assert.deepEqual([call.r, call.g, call.b], [34, 211, 238], "call = cyan #22d3ee");
  assert.deepEqual([put.r, put.g, put.b], [217, 70, 239], "put = magenta #d946ef");
});

test("heatmapCellColor: alpha scales with |cell|/maxAbs and clamps at 1", () => {
  const weak = rgba(heatmapCellColor(10, 100)).a;
  const strong = rgba(heatmapCellColor(90, 100)).a;
  assert.ok(strong > weak, "heavier gamma → more opaque");
  // A cell at/above maxAbs clamps to the ceiling (intensity 1), not beyond.
  const atMax = rgba(heatmapCellColor(100, 100)).a;
  const overMax = rgba(heatmapCellColor(500, 100)).a;
  assert.equal(atMax, overMax, "intensity clamps at 1");
  // Background ceiling stays subtle so candles read on top.
  assert.ok(atMax <= 0.42 + 1e-9);
});

test("heatmapCellColor: zero / empty grid / non-finite → transparent (honest absence)", () => {
  assert.equal(heatmapCellColor(0, 100), HEATMAP_TRANSPARENT);
  assert.equal(heatmapCellColor(50, 0), HEATMAP_TRANSPARENT, "maxAbs 0 = empty grid");
  assert.equal(heatmapCellColor(NaN, 100), HEATMAP_TRANSPARENT);
});

test("bandEdges: tiles an increasing axis with contiguous, non-overlapping bands", () => {
  // Evenly spaced coords 0,10,20 → bands [-5,5],[5,15],[15,25]: end cells mirror the 10-gap.
  const bands = bandEdges([0, 10, 20]);
  assert.deepEqual(bands[0], { lo: -5, hi: 5 });
  assert.deepEqual(bands[1], { lo: 5, hi: 15 });
  assert.deepEqual(bands[2], { lo: 15, hi: 25 });
  // Contiguous: each band's hi is the next band's lo (no gap, no overlap).
  assert.equal(bands[0]!.hi, bands[1]!.lo);
  assert.equal(bands[1]!.hi, bands[2]!.lo);
});

test("bandEdges: works on a decreasing axis (strike coords descend on screen) via min/max", () => {
  // priceToCoordinate is inverted: higher strike → smaller y. Coords 100,60,20 (descending).
  const bands = bandEdges([100, 60, 20]);
  for (const b of bands) assert.ok(b && b.lo < b.hi, "lo<hi regardless of direction");
  assert.deepEqual(bands[1], { lo: 40, hi: 80 }); // midpoints of 100/60 and 60/20
});

test("bandEdges: null coords are skipped; a lone point yields no band", () => {
  const withGap = bandEdges([0, null, 20]);
  assert.equal(withGap[1], null, "unresolved column → no band");
  assert.ok(withGap[0] && withGap[2], "resolved neighbours still get bands");
  assert.deepEqual(bandEdges([42]), [null], "single point → no derivable width");
  assert.deepEqual(bandEdges([null, null]), [null, null]);
});

const grid: GexHeatmapGrid = {
  times: [1000, 1300],
  strikes: [7450, 7500, 7550],
  // t0: put-heavy low strike, call-heavy high strike, zero mid; t1: mirror-ish.
  cells: [
    [-80, 0, 40],
    [-20, 0, 100],
  ],
  maxAbs: 100,
};

test("heatmapRects: one rect per NON-ZERO cell, zero cells skipped, colour tracks sign", () => {
  const rects = heatmapRects(grid, (t) => t / 10, (s) => 10000 - s); // identity-ish resolvable coords
  // 6 cells, 2 are zero → 4 rects.
  assert.equal(rects.length, 4);
  for (const r of rects) {
    assert.ok(r.w > 0 && r.h > 0, "positive extents");
    assert.notEqual(r.color, HEATMAP_TRANSPARENT);
  }
  // Every put cell (negative) is magenta, every call cell (positive) is cyan.
  const negRects = rects.filter((r) => rgba(r.color).r === 217);
  const posRects = rects.filter((r) => rgba(r.color).r === 34);
  assert.equal(negRects.length, 2, "two put cells");
  assert.equal(posRects.length, 2, "two call cells");
});

test("heatmapRects: empty grid / maxAbs 0 → no rects (draws nothing, never fabricates)", () => {
  assert.deepEqual(heatmapRects({ times: [], strikes: [], cells: [], maxAbs: 0 }, () => 0, () => 0), []);
  assert.deepEqual(
    heatmapRects({ ...grid, maxAbs: 0 }, (t) => t, (s) => s),
    [],
    "maxAbs 0 → nothing"
  );
});

test("heatmapRects: a column the time scale can't place is skipped (no rects for it)", () => {
  // Second column unresolvable → only the first column's non-zero cells (2) draw.
  const rects = heatmapRects(grid, (t) => (t === 1000 ? 100 : null), (s) => 10000 - s);
  // With only one resolvable column, bandEdges can't derive an x-width (needs ≥2) → 0 rects.
  assert.equal(rects.length, 0);
});
