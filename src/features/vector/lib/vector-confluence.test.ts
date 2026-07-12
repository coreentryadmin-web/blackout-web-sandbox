import { test } from "node:test";
import assert from "node:assert/strict";
import { confluenceZones, DEFAULT_WEIGHTS, type ConfluenceLevel } from "./vector-confluence";

const SPOT = 1000; // tol default 0.15% → 1.5 pts

test("confluenceZones: stacked independent kinds cluster, score, and rank; lone levels drop", () => {
  const levels: ConfluenceLevel[] = [
    { price: 990.0, kind: "put-wall" },       // cluster A
    { price: 990.8, kind: "golden-pocket" },  // A (0.8 ≤ 1.5 from 990)
    { price: 991.5, kind: "pdl" },            // A (chain: 0.7 from 990.8)
    { price: 1010, kind: "call-wall" },       // lone call wall — single kind, dropped
    { price: 1020, kind: "max-pain" },        // cluster B
    { price: 1021, kind: "gamma-flip" },      // B
  ];
  const zones = confluenceZones(levels, SPOT);
  assert.equal(zones.length, 2, "lone call wall is not confluence");

  // A: put-wall 3 + pocket 2 + pdl 1.5 = 6.5 beats B: max-pain 2 + flip 2.5 = 4.5.
  const [a, b] = zones;
  assert.deepEqual(a!.kinds.sort(), ["golden-pocket", "pdl", "put-wall"]);
  assert.equal(a!.score, 6.5);
  assert.equal(b!.score, 4.5);
  // Bounds + weighted center: (3·990 + 2·990.8 + 1.5·991.5) / 6.5 = 990.592…
  assert.equal(a!.low, 990);
  assert.equal(a!.high, 991.5);
  assert.ok(Math.abs(a!.center - (3 * 990 + 2 * 990.8 + 1.5 * 991.5) / 6.5) < 1e-9);
});

test("confluenceZones: one kind repeated is NOT confluence (five fib lines ≠ five signals)", () => {
  const zones = confluenceZones(
    [
      { price: 1000, kind: "golden-pocket" },
      { price: 1000.5, kind: "golden-pocket" },
      { price: 1001, kind: "golden-pocket" },
    ],
    SPOT
  );
  assert.deepEqual(zones, []);
});

test("confluenceZones: chain merge — adjacent-within-tol links even when the span exceeds tol", () => {
  // 999 → 1000.2 → 1001.4: each hop 1.2 ≤ 1.5 but the span (2.4) exceeds tol — still ONE zone.
  const zones = confluenceZones(
    [
      { price: 999, kind: "call-wall" },
      { price: 1000.2, kind: "max-pain" },
      { price: 1001.4, kind: "pivot" },
    ],
    SPOT
  );
  assert.equal(zones.length, 1);
  assert.equal(zones[0]!.levels.length, 3);
});

test("confluenceZones: custom weight overrides the kind default (integrity-scaled walls)", () => {
  const zones = confluenceZones(
    [
      { price: 1000, kind: "call-wall", weight: 1.2 }, // thin wall, scaled down
      { price: 1000.5, kind: "max-pain" },
    ],
    SPOT
  );
  assert.equal(zones[0]!.score, 1.2 + DEFAULT_WEIGHTS["max-pain"]);
});

test("confluenceZones: equal scores rank the zone nearest spot first", () => {
  const zones = confluenceZones(
    [
      { price: 980, kind: "hod" },
      { price: 980.5, kind: "lod" }, // score 2, ~19.7 from spot
      { price: 1004, kind: "hod" },
      { price: 1004.5, kind: "lod" }, // score 2, ~4.3 from spot → first
    ],
    SPOT
  );
  assert.equal(zones.length, 2);
  assert.ok(Math.abs(zones[0]!.center - 1004.25) < 0.01);
});

test("confluenceZones: quiet on junk — bad spot, non-finite prices, <2 usable levels", () => {
  assert.deepEqual(confluenceZones([{ price: 1000, kind: "hod" }], 0), []);
  assert.deepEqual(confluenceZones([{ price: NaN, kind: "hod" }, { price: 1000, kind: "lod" }], SPOT), []);
  assert.deepEqual(confluenceZones([], SPOT), []);
});
