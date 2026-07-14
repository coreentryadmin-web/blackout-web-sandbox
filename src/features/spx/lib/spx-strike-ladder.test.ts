import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLadderAxisRows,
  fallbackLadderRange,
  ladderBarThickness,
  ladderRowGapPx,
  ladderY,
  type LadderScale,
} from "./spx-strike-ladder";

const SCALE: LadderScale = { rangeMin: 6200, rangeMax: 6300, height: 500 };

test("ladderY: linear fallback maps like the chart's linear scale", () => {
  assert.equal(ladderY(SCALE, 6300), 0);
  assert.equal(ladderY(SCALE, 6200), 500);
  assert.equal(ladderY(SCALE, 6250), 250);
});

test("ladderY: chart-native mapping preferred; falls back when it returns null", () => {
  const native: LadderScale = { ...SCALE, priceToY: (p) => (p === 6250 ? 123 : null) };
  assert.equal(ladderY(native, 6250), 123); // native wins
  assert.equal(ladderY(native, 6300), 0); // null → exact linear fallback
});

test("fallbackLadderRange: spot-centered pad, strike-extent fallback, null when hopeless", () => {
  const r = fallbackLadderRange(6250, [], 0.012)!;
  assert.ok(Math.abs(r.rangeMin - (6250 - 75)) < 1e-9);
  assert.ok(Math.abs(r.rangeMax - (6250 + 75)) < 1e-9);
  assert.deepEqual(fallbackLadderRange(null, [6100, 6200, 6300]), {
    rangeMin: 6100,
    rangeMax: 6300,
  });
  assert.equal(fallbackLadderRange(null, [6100]), null);
  assert.equal(fallbackLadderRange(0, []), null);
});

test("ladderBarThickness clamps to [2, 9]px", () => {
  assert.equal(ladderBarThickness(4), 2);
  assert.equal(ladderBarThickness(10), 6);
  assert.equal(ladderBarThickness(100), 9);
  assert.equal(ladderBarThickness(Number.NaN), 2);
});

test("buildLadderAxisRows: filters to visible range, sorts top-down, normalises to visible peak", () => {
  const rows = buildLadderAxisRows({
    strikes: [6150, 6220, 6250, 6280, 6350], // 6150/6350 outside range
    totals: { "6220": -2_000_000, "6250": 500_000, "6280": 1_000_000 },
    scale: SCALE,
    king: 6220,
    callWall: 6280,
    putWall: 6220,
  });
  assert.deepEqual(
    rows.map((r) => r.strike),
    [6280, 6250, 6220] // highest strike first (smallest y)
  );
  const byStrike = Object.fromEntries(rows.map((r) => [r.strike, r]));
  // Peak among VISIBLE rows is |−2M| → widths normalise against it.
  assert.equal(byStrike[6220]!.widthPct, 100);
  assert.equal(byStrike[6280]!.widthPct, 50);
  assert.equal(byStrike[6250]!.widthPct, 25);
  assert.equal(byStrike[6220]!.king, true);
  assert.equal(byStrike[6220]!.putWall, true);
  assert.equal(byStrike[6280]!.callWall, true);
  assert.equal(byStrike[6250]!.king, false);
});

test("buildLadderAxisRows: y positions come from the shared scale", () => {
  const rows = buildLadderAxisRows({
    strikes: [6225, 6275],
    totals: {},
    scale: SCALE,
    king: null,
    callWall: null,
    putWall: null,
  });
  const byStrike = Object.fromEntries(rows.map((r) => [r.strike, r]));
  assert.equal(byStrike[6275]!.y, 125);
  assert.equal(byStrike[6225]!.y, 375);
});

test("buildLadderAxisRows: label density gate — tight rows only label king/wall rows", () => {
  // 60 strikes over 500px → ~8.5px gaps, below the 12px label gate.
  const strikes = Array.from({ length: 60 }, (_, i) => 6201 + i * 1.65);
  const rows = buildLadderAxisRows({
    strikes,
    totals: {},
    scale: SCALE,
    king: strikes[30]!,
    callWall: null,
    putWall: null,
  });
  const labelled = rows.filter((r) => r.label);
  assert.equal(labelled.length, 1);
  assert.equal(labelled[0]!.strike, strikes[30]!);
});

test("buildLadderAxisRows: roomy rows all get labels; zero totals draw zero-width bars", () => {
  const rows = buildLadderAxisRows({
    strikes: [6220, 6250, 6280],
    totals: {},
    scale: SCALE,
    king: null,
    callWall: null,
    putWall: null,
  });
  assert.ok(rows.every((r) => r.label));
  assert.ok(rows.every((r) => r.widthPct === 0));
});

test("buildLadderAxisRows: degenerate scale returns no rows", () => {
  assert.deepEqual(
    buildLadderAxisRows({
      strikes: [6250],
      totals: {},
      scale: { rangeMin: 6300, rangeMax: 6200, height: 500 },
      king: null,
      callWall: null,
      putWall: null,
    }),
    []
  );
});

test("ladderRowGapPx: median gap between adjacent rows", () => {
  const rows = buildLadderAxisRows({
    strikes: [6220, 6240, 6260, 6280],
    totals: {},
    scale: SCALE,
    king: null,
    callWall: null,
    putWall: null,
  });
  assert.equal(ladderRowGapPx(rows), 100); // 20pt over a 100pt/500px scale = 100px
  assert.equal(ladderRowGapPx([]), 12);
});
