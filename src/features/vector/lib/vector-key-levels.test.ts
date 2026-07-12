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

test("levelLinesFor fib-auto: DOMINANT swing, distinct labels, golden-pocket band; [] on noise/structureless", async () => {
  const { levelLinesFor } = await import("./vector-key-levels");
  // Dominant down swing: pivot high 105.5 (idx 3) → pivot low 96.5 (idx 9), range 9 (well over the
  // 0.15%-of-~100 ≈ 0.15 floor), then partial recovery. k=3 = 7-bar fractal.
  const path = [100, 101, 102, 105, 103, 101, 99, 98, 97.5, 97, 98, 99, 100];
  const bars = path.map((p, i) => ({ time: 60 * i, high: p + 0.5, low: p - 0.5, close: p }));
  const lines = levelLinesFor("fib-auto", bars);
  const by = (k) => lines.find((l) => l.key === k);

  // 5 lines, every label distinct (the two-golden-pockets bug fix).
  assert.equal(lines.length, 5);
  assert.equal(new Set(lines.map((l) => l.label)).size, 5, "no duplicate labels");
  // Swing high/low labelled by what they are; pocket band = 96.5 + {0.618,0.65}·9 = {102.062, 102.35}.
  assert.equal(by("afib-high").price, 105.5);
  assert.ok(by("afib-high").label.startsWith("Swing high"));
  assert.equal(by("afib-low").price, 96.5);
  assert.ok(by("afib-low").label.startsWith("Swing low"));
  assert.equal(by("afib-50").price, 101);
  assert.equal(by("afib-50").label, "Fib 50%");
  assert.ok(Math.abs(by("afib-gp618").price - 102.062) < 1e-9 && by("afib-gp618").label === "Golden pocket 61.8%");
  assert.ok(Math.abs(by("afib-gp65").price - 102.35) < 1e-9 && by("afib-gp65").label === "Golden pocket 65%");

  // NOISE guard: a hairline oscillation (~0.03% legs, far under the 0.15% floor) → NO lines, so
  // the pocket never collapses to a useless sliver clinging to spot (the reported bug).
  const noise = Array.from({ length: 15 }, (_, i) => { const p = 754 + (i % 2 ? 0.1 : -0.1); return { time: 60 * i, high: p + 0.05, low: p - 0.05, close: p }; });
  assert.deepEqual(levelLinesFor("fib-auto", noise), []);
  // Structureless (monotone rise) → [] too.
  const flat = Array.from({ length: 13 }, (_, i) => ({ time: 60 * i, high: 100 + i + 0.5, low: 100 + i - 0.5, close: 100 + i }));
  assert.deepEqual(levelLinesFor("fib-auto", flat), []);
});
