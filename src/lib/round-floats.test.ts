import { test } from "node:test";
import assert from "node:assert/strict";
import { roundFloats, reconcileStrikeTotal } from "./round-floats";

test("rounds spurious float noise to 2dp by default", () => {
  assert.equal(roundFloats(7499.360000000001), 7499.36);
  assert.equal(roundFloats(-12701691969.618551), -12701691969.62);
});

test("leaves integers untouched (timestamps, counts, IDs)", () => {
  assert.equal(roundFloats(1751000000000), 1751000000000);
  assert.equal(roundFloats(0), 0);
  assert.equal(roundFloats(-42), -42);
});

test("leaves NaN/Infinity untouched rather than producing garbage", () => {
  assert.equal(roundFloats(NaN), NaN);
  assert.equal(roundFloats(Infinity), Infinity);
  assert.equal(roundFloats(-Infinity), -Infinity);
});

test("walks nested objects and arrays", () => {
  const input = {
    price: 7529.650000000001,
    meta: { vwap: 7514.418974358975, count: 12 },
    rows: [{ entry: 7430.900000000001, id: 9007199254740 }, { entry: null }],
  };
  assert.deepEqual(roundFloats(input), {
    price: 7529.65,
    meta: { vwap: 7514.42, count: 12 },
    rows: [{ entry: 7430.9, id: 9007199254740 }, { entry: null }],
  });
});

test("supports a custom decimal-place count", () => {
  assert.equal(roundFloats(1.23456, 4), 1.2346);
});

test("passes through non-numeric leaves unchanged", () => {
  assert.deepEqual(roundFloats({ a: "text", b: true, c: null, d: undefined }), {
    a: "text",
    b: true,
    c: null,
    d: undefined,
  });
});

// ── reconcileStrikeTotal — live-caught P0: NVDA GEX Σstrike_totals != total ────────

test("reconcileStrikeTotal: reproduces the live NVDA bug — independently-rounded total drifts from the sum of rounded strike_totals, and gets fixed", () => {
  // Same shape as production: total rounded on its own (-3032.31), strike_totals
  // rounded on their own and summing to -3032.30 — a $0.01 drift from rounding
  // composition, not a wrong number (both derive from the same raw accumulation).
  const block = { total: -3032.31, strike_totals: { "100": -1000.1, "105": -2032.2 } };
  const fixed = reconcileStrikeTotal(block)!;
  assert.equal(fixed.total, -3032.3);
  const sum = Object.values(fixed.strike_totals!).reduce((a, b) => a + b, 0);
  assert.equal(fixed.total, Math.round(sum * 100) / 100);
});

test("reconcileStrikeTotal: total exactly equals the sum whenever they already agree", () => {
  const block = { total: 100, strike_totals: { "50": 40, "55": 60 } };
  assert.equal(reconcileStrikeTotal(block)!.total, 100);
});

test("reconcileStrikeTotal: passes through blocks without strike_totals (e.g. undefined dex/charm) unchanged", () => {
  assert.equal(reconcileStrikeTotal(undefined), undefined);
  const noStrikes = { total: 5 };
  assert.equal(reconcileStrikeTotal(noStrikes), noStrikes);
});

test("reconcileStrikeTotal: an empty strike_totals map reconciles to a zero total", () => {
  const block = { total: 999, strike_totals: {} };
  assert.equal(reconcileStrikeTotal(block)!.total, 0);
});

test("reconcileStrikeTotal: ignores non-finite strike values rather than propagating NaN", () => {
  const block = { total: 5, strike_totals: { "1": 10, "2": NaN } };
  assert.equal(reconcileStrikeTotal(block)!.total, 10);
});

// RTH-scan regression (2026-07-13): Vector served the weekly gamma flip as 7622.381430556295. The
// data-layer boundary (src/lib/bie/vector-full-state.ts wraps its whole return in roundFloats) must
// serve every structure figure at 2dp. This pins the exact scanned number and a VectorFullState-
// shaped nested object so a future refactor that drops the roundFloats wrap is caught here.
test("Vector data-layer: the flagged unrounded weekly flip 7622.381430556295 serves as 7622.38", () => {
  assert.equal(roundFloats(7622.381430556295), 7622.38);
});

test("Vector data-layer: flip / walls / max pain / vexFlip / ladder round while epoch-ints are untouched", () => {
  const rounded = roundFloats({
    gammaFlip: 7622.381430556295,
    maxPain: 7554.987654321,
    vexFlip: 7600.501999,
    gexWalls: {
      callWalls: [{ strike: 7647.111111, pct: 0.4123456 }],
      putWalls: [{ strike: 7500.999999, pct: 0.31 }],
    },
    ladder: { rows: [{ strike: 7625.5, gex: 1234.56789, magnitude: 0.876543 }], maxAbs: 9999.99999 },
    // Integer-valued fields must pass through UNCHANGED (epoch millis, counts).
    asOfMs: 1720000000000,
    strikeCount: 42,
  }) as Record<string, unknown>;

  assert.equal(rounded.gammaFlip, 7622.38);
  assert.equal(rounded.maxPain, 7554.99);
  assert.equal(rounded.vexFlip, 7600.5);
  const walls = rounded.gexWalls as { callWalls: Array<{ strike: number; pct: number }>; putWalls: Array<{ strike: number }> };
  assert.equal(walls.callWalls[0]!.strike, 7647.11);
  assert.equal(walls.callWalls[0]!.pct, 0.41);
  assert.equal(walls.putWalls[0]!.strike, 7501);
  const ladder = rounded.ladder as { rows: Array<{ gex: number; magnitude: number }>; maxAbs: number };
  assert.equal(ladder.rows[0]!.gex, 1234.57);
  assert.equal(ladder.rows[0]!.magnitude, 0.88);
  assert.equal(ladder.maxAbs, 10000);
  // Untouched integers.
  assert.equal(rounded.asOfMs, 1720000000000);
  assert.equal(rounded.strikeCount, 42);
});
