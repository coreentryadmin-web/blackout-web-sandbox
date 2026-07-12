import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sessionHodLod,
  openingRange,
  fibLevels,
  floorPivots,
  levelLinesFor,
  FIB_RATIOS,
} from "./vector-key-levels";

const bar = (time: number, high: number, low: number, close = (high + low) / 2) => ({
  time,
  high,
  low,
  close,
});

test("sessionHodLod: session extremes; null when empty", () => {
  const bars = [bar(0, 101, 99), bar(60, 104, 100), bar(120, 103, 97)];
  assert.deepEqual(sessionHodLod(bars), { hod: 104, lod: 97 });
  assert.equal(sessionHodLod([]), null);
});

test("openingRange: first N minutes only, half-open at the boundary", () => {
  const t0 = 1_000_000;
  const bars = [
    bar(t0, 101, 100),
    bar(t0 + 60, 103, 99), // in the 15m window
    bar(t0 + 14 * 60, 102, 98), // in
    bar(t0 + 15 * 60, 110, 90), // AT the boundary → excluded
    bar(t0 + 20 * 60, 120, 80), // after → excluded
  ];
  assert.deepEqual(openingRange(bars, 15), { high: 103, low: 98 });
  assert.equal(openingRange([], 15), null);
  assert.equal(openingRange(bars, 0), null);
});

test("fibLevels: 0%=high, 100%=low, 50% midpoint, 61.8% golden; degenerate → []", () => {
  const levels = fibLevels(200, 100);
  assert.equal(levels.length, FIB_RATIOS.length);
  const at = (r) => levels.find((l) => l.ratio === r).price;
  assert.equal(at(0), 200);
  assert.equal(at(1), 100);
  assert.equal(at(0.5), 150);
  assert.ok(Math.abs(at(0.618) - (200 - 0.618 * 100)) < 1e-9); // 138.2
  assert.deepEqual(fibLevels(100, 100), []); // zero range
  assert.deepEqual(fibLevels(90, 100), []); // inverted
});

test("levelLinesFor: hod-lod / opening-range / fib produce labelled lines; empty bars → []", () => {
  const t0 = 2_000_000;
  const bars = [bar(t0, 105, 100), bar(t0 + 60, 110, 98), bar(t0 + 20 * 60, 112, 95)];

  const hl = levelLinesFor("hod-lod", bars);
  assert.deepEqual(hl.map((l) => l.label).sort(), ["HOD", "LOD"]);
  assert.equal(hl.find((l) => l.label === "HOD").price, 112);
  assert.equal(hl.find((l) => l.label === "LOD").price, 95);

  const or = levelLinesFor("opening-range", bars);
  // OR window = first 15m → bars at t0 and t0+60 (t0+20m excluded): high 110, low 98.
  assert.equal(or.find((l) => l.key === "or-high").price, 110);
  assert.equal(or.find((l) => l.key === "or-low").price, 98);

  const fib = levelLinesFor("fib", bars);
  assert.equal(fib.length, FIB_RATIOS.length);
  assert.equal(fib.find((l) => l.key === "fib-0").price, 112); // HOD
  assert.equal(fib.find((l) => l.key === "fib-1").price, 95); // LOD

  assert.deepEqual(levelLinesFor("hod-lod", []), []);
  assert.deepEqual(levelLinesFor("fib", []), []);
});

test("floorPivots: classic formulas from prior H/L/C; non-finite → null", () => {
  // H=110 L=90 C=100 → P=100, R1=110, S1=90, R2=120, S2=80, R3=130, S3=70.
  const p = floorPivots(110, 90, 100);
  assert.ok(p);
  assert.equal(p.p, 100);
  assert.equal(p.r1, 110);
  assert.equal(p.s1, 90);
  assert.equal(p.r2, 120);
  assert.equal(p.s2, 80);
  assert.equal(p.r3, 130);
  assert.equal(p.s3, 70);
  assert.equal(floorPivots(Number.NaN, 90, 100), null);
});

test("levelLinesFor: pdh-pdl-pdc + pivots need priorDay; null → [] (never a bogus line)", () => {
  const prior = { pdh: 110, pdl: 90, pdc: 100 };
  const pd = levelLinesFor("pdh-pdl-pdc", [], prior);
  assert.deepEqual(pd.map((l) => l.key).sort(), ["pdc", "pdh", "pdl"]);
  assert.equal(pd.find((l) => l.key === "pdh").price, 110);

  const piv = levelLinesFor("pivots", [], prior);
  assert.deepEqual(piv.map((l) => l.key), ["piv-p", "piv-r1", "piv-r2", "piv-r3", "piv-s1", "piv-s2", "piv-s3"]);
  assert.equal(piv.find((l) => l.key === "piv-p").price, 100);

  // No prior-day loaded yet → nothing drawn.
  assert.deepEqual(levelLinesFor("pdh-pdl-pdc", [], null), []);
  assert.deepEqual(levelLinesFor("pivots", [], undefined), []);
});

test("levelLinesFor fib-auto: golden pocket + swing levels from the LAST fractal swing; [] without structure", async () => {
  const { levelLinesFor } = await import("./vector-key-levels");
  // Down swing: pivot high 105.5 (idx 3), pivot low 96.5 (idx 9), then partial recovery. k=3 needs
  // 3 confirming bars each side.
  const path = [100, 101, 102, 105, 103, 101, 99, 98, 97.5, 97, 98, 99, 100];
  const bars = path.map((p, i) => ({ time: 60 * i, high: p + 0.5, low: p - 0.5, close: p }));
  const lines = levelLinesFor("fib-auto", bars);
  const by = (k) => lines.find((l) => l.key === k);

  // Down swing 105.5→96.5 (range 9): 0% = 96.5, 50% = 101, pocket = 96.5 + {0.618,0.65}·9 =
  // {102.062, 102.35}, 100% = 105.5.
  assert.equal(lines.length, 5);
  assert.equal(by("afib-0").price, 96.5);
  assert.equal(by("afib-100").price, 105.5);
  assert.equal(by("afib-50").price, 101);
  assert.ok(Math.abs(by("afib-gp-b").price - 102.062) < 1e-9);
  assert.ok(Math.abs(by("afib-gp-a").price - 102.35) < 1e-9);
  assert.ok(by("afib-0").label.includes("↓"), "direction marked on the swing bounds");
  // Pocket sits strictly inside the swing.
  assert.ok(by("afib-gp-b").price > 96.5 && by("afib-gp-a").price < 105.5);

  // No structure (monotone rise → no confirmed pivot high) → no lines, never a bogus level.
  const flat = Array.from({ length: 13 }, (_, i) => ({ time: 60 * i, high: 100 + i + 0.5, low: 100 + i - 0.5, close: 100 + i }));
  assert.deepEqual(levelLinesFor("fib-auto", flat), []);
});
