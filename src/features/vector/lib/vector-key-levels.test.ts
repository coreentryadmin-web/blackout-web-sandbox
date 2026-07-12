import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sessionHodLod,
  openingRange,
  fibLevels,
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
