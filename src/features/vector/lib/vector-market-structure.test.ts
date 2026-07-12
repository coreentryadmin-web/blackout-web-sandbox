import { test } from "node:test";
import assert from "node:assert/strict";
import { labelPivots, detectStructureEvents } from "./vector-market-structure";

/** Bars from a mid-price path: high = p+0.5, low = p−0.5, close = p. */
const barsFrom = (path: number[]) =>
  path.map((p, i) => ({ time: 60 * i, high: p + 0.5, low: p - 0.5, close: p }));

// Hand-traced scenario (k=2):
//  i:  0    1    2    3    4    5    6    7    8    9   10   11   12   13   14
//  p: 100  102  104  102  101  103  105  106  104  103  104  105   98   97   99
// Pivot highs: i=2 (104.5, "H"), i=7 (106.5, HH), i=11 (105.5, LH).
// Pivot lows:  i=4 (100.5, "L"), i=9 (102.5, HL). i=13 is inside the unconfirmable edge.
const PATH = [100, 102, 104, 102, 101, 103, 105, 106, 104, 103, 104, 105, 98, 97, 99];

test("labelPivots: HH/LH/HL/LL vs same-kind predecessor; first of each kind plain H/L", () => {
  const pivots = labelPivots(barsFrom(PATH), 2);
  assert.deepEqual(
    pivots.map((p) => [p.index, p.kind, p.label, p.price]),
    [
      [2, "high", "H", 104.5],
      [4, "low", "L", 100.5],
      [7, "high", "HH", 106.5],
      [9, "low", "HL", 102.5],
      [11, "high", "LH", 105.5],
    ]
  );
});

test("detectStructureEvents: first break is BOS (establishes trend), break against trend is CHOCH", () => {
  const events = detectStructureEvents(barsFrom(PATH), 2);
  // j=6: first close (105) above the confirmed i=2 high (104.5) → BOS up.
  // j=12: close (98) below the confirmed i=9 low (102.5) while trend is up → CHOCH down.
  assert.deepEqual(
    events.map((e) => [e.index, e.type, e.direction, e.level]),
    [
      [6, "BOS", "up", 104.5],
      [12, "CHOCH", "down", 102.5],
    ]
  );
});

test("detectStructureEvents: mirrored path yields BOS down then CHOCH up (down-trend branch)", () => {
  const mirrored = PATH.map((p) => 200 - p);
  const events = detectStructureEvents(barsFrom(mirrored), 2);
  assert.deepEqual(
    events.map((e) => [e.index, e.type, e.direction, e.level]),
    [
      [6, "BOS", "down", 200 - 104.5],
      [12, "CHOCH", "up", 200 - 102.5],
    ]
  );
});

test("detectStructureEvents: no lookahead — a pivot can't be broken before it is confirmed", () => {
  // Close pokes above the future pivot high BEFORE i+k: bars 0..3 rise through 104.5's level while
  // the pivot at i=2 is only confirmed at bar 4 — the break must be dated ≥ 4, not at bar 3.
  const path = [100, 102, 104, 105, 101, 100, 99, 106, 107, 108, 109];
  // Pivot high i=3? window[1..5] highs: 102.5,104.5,105.5,101.5,100.5 → pivot at i=3 (105.5),
  // confirmed at 5. First close above 105.5 is bar 7 (106) — the event must land there.
  const events = detectStructureEvents(barsFrom(path), 2);
  const up = events.find((e) => e.direction === "up");
  assert.ok(up && up.index === 7 && up.level === 105.5, `event at 7, got ${JSON.stringify(events)}`);
});

test("detectStructureEvents: each level breaks once (no repeat events on a dead pivot)", () => {
  const events = detectStructureEvents(barsFrom(PATH), 2);
  const levels = events.map((e) => e.level);
  assert.equal(new Set(levels).size, levels.length);
});

test("labelPivots/detectStructureEvents: quiet on empty/structureless input", () => {
  assert.deepEqual(labelPivots([], 2), []);
  assert.deepEqual(detectStructureEvents(barsFrom([1, 2, 3, 4, 5, 6]), 2), []);
});
