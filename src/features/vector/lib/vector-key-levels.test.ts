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

// RTH ET anchor (09:30 ET, Mon 2026-07-13) for the basic fixtures. Session levels are now RTH-gated
// (P1-A: equity/ETF feeds carry premarket bars, so OR/HOD/LOD/VWAP must anchor to 09:30, not 04:00),
// so fixtures must use real regular-hours timestamps or the gate would filter them all out.
const RTH0 = Math.floor(Date.parse("2026-07-13T09:30:00-04:00") / 1000);

test("sessionHodLod: session extremes; null when empty", () => {
  const bars = [bar(RTH0, 101, 99), bar(RTH0 + 60, 104, 100), bar(RTH0 + 120, 103, 97)];
  assert.deepEqual(sessionHodLod(bars), { hod: 104, lod: 97 });
  assert.equal(sessionHodLod([]), null);
});

test("openingRange: first N minutes only, half-open at the boundary", () => {
  const t0 = RTH0;
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
  const t0 = RTH0;
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

// ---------------------------------------------------------------------------------------------
// MULTI-SESSION SCOPING (P0, 2026-07-14): the chart seeds ~3 sessions (vector-seed-bars
// TARGET_SEED_SESSIONS = 3), so every session-anchored level must scope to the LAST ET day.
// Regression for the member-reported bug: "Opening H and L on SPX Slayer shows FRIDAY's ranges".
// Fixture: three real ET trading days (Thu 2026-07-09, Fri 2026-07-10, Mon 2026-07-13), each
// with DISTINCT extremes; the oldest session is deliberately the widest so any whole-array
// min/max (the old bug) is caught, and Friday's open differs from Monday's so an "or from
// bars[0]" regression is caught too.
// ---------------------------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lastSessionBars } from "./vector-key-levels";
import { aggregateVectorBars } from "./vector-bar-timeframes";

/** Epoch seconds for an ET (EDT, UTC-4) wall-clock time on a given date. */
const et = (ymd: string, hh: number, mm: number) =>
  Math.floor(Date.parse(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-04:00`) / 1000);

/** One RTH-open session of 1m bars: `points` = [high, low] per minute from 09:30 ET. */
function session(ymd: string, points: Array<[number, number]>) {
  return points.map(([high, low], i) => ({
    time: et(ymd, 9, 30) + i * 60,
    high,
    low,
    close: (high + low) / 2,
    volume: 100,
  }));
}

// Thu: widest range of the three (HOD 120 / LOD 80) — the old whole-array HOD/LOD.
const thu = session("2026-07-09", [[110, 100], [120, 105], [100, 80], [105, 95]]);
// Fri: opening 15m range 118–112 — the old bars[0]-anchored opening range... except bars[0] was
// actually THU's open; either way, distinct from Monday's so any non-last-session anchor fails.
const fri = session("2026-07-10", [[115, 112], [118, 113], [117, 112], [116, 85], [115, 111]]);
// Mon (LAST session): HOD 105 / LOD 95; the first 15 MINUTES (bars 0–14, 09:30–09:44) top out at
// 103/96, and the session extremes land at 09:45+ — so OR ≠ HOD/LOD at every timeframe (the
// 09:45 bucket boundary aligns for 1m, 5m and 15m aggregation alike).
const mon = session("2026-07-13", [
  ...Array.from({ length: 15 }, (_, i): [number, number] => (i === 7 ? [103, 96] : [102, 98])),
  [105, 99],
  [104, 95],
  [103, 100],
]);
const multi = [...thu, ...fri, ...mon];

test("lastSessionBars: slices to the trailing ET-day run; single session passes through", () => {
  assert.deepEqual(lastSessionBars(multi), mon);
  assert.deepEqual(lastSessionBars(mon), mon);
  assert.deepEqual(lastSessionBars([]), []);
});

test("sessionHodLod over 3 seeded sessions = LAST session's extremes only", () => {
  // Old bug: min/max over the whole array → Thu's 120/80.
  assert.deepEqual(sessionHodLod(multi), { hod: 105, lod: 95 });
});

test("openingRange over 3 seeded sessions = LAST session's first 15m (not Friday's, not Thursday's)", () => {
  // Old bug: measured from bars[0].time = the OLDEST session's open (the literal member report).
  assert.deepEqual(openingRange(multi, 15), { high: 103, low: 96 });
});

test("fib over 3 seeded sessions anchors 0%/100% to the LAST session's HOD/LOD", () => {
  const fib = levelLinesFor("fib", multi);
  assert.equal(fib.find((l) => l.key === "fib-0")!.price, 105);
  assert.equal(fib.find((l) => l.key === "fib-1")!.price, 95);
  // 61.8% golden = 105 − 0.618·10
  assert.ok(Math.abs(fib.find((l) => l.key === "fib-0.618")!.price - 98.82) < 1e-9);
});

test("session scoping survives 5m/15m aggregation (bucket-start times keep their ET day)", () => {
  for (const tf of [5, 15]) {
    const agg = aggregateVectorBars(multi, tf);
    assert.deepEqual(sessionHodLod(agg), { hod: 105, lod: 95 }, `HOD/LOD @ ${tf}m`);
    // Mon's opening window (09:30–09:45) aligns with the 5m/15m bucket grid, so the aggregated
    // OR equals the 1m OR exactly — and is MONDAY's window, never Thu's 120/80 or Fri's.
    assert.deepEqual(openingRange(agg, 15), { high: 103, low: 96 }, `OR @ ${tf}m`);
    const fib = levelLinesFor("fib", agg);
    assert.equal(fib.find((l) => l.key === "fib-0")!.price, 105, `fib 0% @ ${tf}m`);
    assert.equal(fib.find((l) => l.key === "fib-1")!.price, 95, `fib 100% @ ${tf}m`);
  }
});

test("prior-day + pivot lines derive from the session immediately BEFORE the last (passed as priorDay)", () => {
  // With Monday displayed, priorDay must be FRIDAY's OHLC (the /prior-day route walks back from
  // the chart's anchor=sessionYmd; selection is unit-tested in spx-session.test.ts). Assert the
  // level lines faithfully draw from that prior session — P from Friday's H/L/C, PDH at its high.
  const fridayOhlc = { pdh: 118, pdl: 85, pdc: 113.5 };
  const pd = levelLinesFor("pdh-pdl-pdc", multi, fridayOhlc);
  assert.equal(pd.find((l) => l.key === "pdh")!.price, 118);
  assert.equal(pd.find((l) => l.key === "pdl")!.price, 85);
  assert.equal(pd.find((l) => l.key === "pdc")!.price, 113.5);
  const piv = levelLinesFor("pivots", multi, fridayOhlc);
  assert.ok(Math.abs(piv.find((l) => l.key === "piv-p")!.price - (118 + 85 + 113.5) / 3) < 1e-9);
});

test("guard: VectorChart's prior-day fetch is anchored to the DISPLAYED session (anchor=sessionYmd)", () => {
  // Drift guard in the repo's readFileSync style: without the anchor, a weekend/pre-open member
  // gets PDH/PDL equal to the displayed session's own extremes (see spx-session.test.ts).
  const src = readFileSync(
    join(process.cwd(), "src/features/vector/components/VectorChart.tsx"),
    "utf8"
  );
  assert.match(src, /prior-day\?ticker=\$\{encodeURIComponent\(ticker\)\}/);
  assert.match(src, /anchor=\$\{encodeURIComponent\(sessionYmd\)\}/);
});

// ---------------------------------------------------------------------------------------------
// P1-A (live sweep 2026-07-14): equity/ETF minute feeds carry PRE-MARKET bars (from 04:00 ET).
// Session-anchored levels must gate to the 09:30 RTH open — NOT the 04:00 premarket open — so
// e.g. TSLA OR-H reads the true-RTH 400.82, not the premarket-anchored 395.60. SPX (no premarket
// bars) is unaffected. Fixture: a premarket block with EXTREME prints that must never leak into
// the session levels, followed by the real RTH session.
// ---------------------------------------------------------------------------------------------

function sessionWithPremarket(ymd: string) {
  // Premarket 08:00–08:02 ET with absurd extremes (high 999 / low 1) that MUST be excluded.
  const pre = Array.from({ length: 3 }, (_, i) => ({
    time: et(ymd, 8, 0) + i * 60,
    high: 999,
    low: 1,
    close: 500,
    volume: 50,
  }));
  // RTH from 09:30: first 15m (bars 0–14) ranges 99–103; the true session extremes 108/92 land at
  // 09:45+, so OR ≠ HOD/LOD and both must reflect RTH only.
  const rth = session(ymd, [
    ...Array.from({ length: 15 }, (_, i): [number, number] => (i === 7 ? [103, 99] : [102, 100])),
    [108, 101],
    [107, 92],
    [104, 100],
  ]);
  return [...pre, ...rth];
}

test("P1-A: session HOD/LOD gate to RTH — premarket extremes (999/1) never leak in", () => {
  const bars = sessionWithPremarket("2026-07-13");
  assert.deepEqual(sessionHodLod(bars), { hod: 108, lod: 92 });
});

test("P1-A: opening range anchors to the 09:30 RTH open, not the 04:00 premarket open", () => {
  const bars = sessionWithPremarket("2026-07-13");
  // First 15m of RTH (09:30–09:44) = 99–103. NOT the premarket 999/1, NOT the post-open 108/92.
  assert.deepEqual(openingRange(bars, 15), { high: 103, low: 99 });
});

test("P1-A: fib anchors to the RTH session's HOD/LOD (premarket excluded)", () => {
  const bars = sessionWithPremarket("2026-07-13");
  const fib = levelLinesFor("fib", bars);
  assert.equal(fib.find((l) => l.key === "fib-0")!.price, 108);
  assert.equal(fib.find((l) => l.key === "fib-1")!.price, 92);
});

test("P1-A: premarket-only bars (no RTH yet) → null levels, never a premarket-anchored line", () => {
  const preOnly = Array.from({ length: 3 }, (_, i) => ({
    time: et("2026-07-13", 8, 0) + i * 60,
    high: 999,
    low: 1,
    close: 500,
  }));
  assert.equal(sessionHodLod(preOnly), null);
  assert.equal(openingRange(preOnly, 15), null);
  assert.deepEqual(levelLinesFor("hod-lod", preOnly), []);
});
