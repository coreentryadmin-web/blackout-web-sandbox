import { test } from "node:test";
import assert from "node:assert/strict";
import {
  screenUniverse,
  screenerRegimeOf,
  flipDistancePct,
  wallStrength,
} from "./vector-screener";
import type { VectorUniverseRow } from "./vector-universe";

function row(p: Partial<VectorUniverseRow> & { ticker: string }): VectorUniverseRow {
  return {
    ticker: p.ticker,
    spot: p.spot ?? null,
    gammaFlip: p.gammaFlip ?? null,
    vexFlip: p.vexFlip ?? null,
    topCallWall: p.topCallWall ?? null,
    topPutWall: p.topPutWall ?? null,
    topCallPct: p.topCallPct ?? null,
    topPutPct: p.topPutPct ?? null,
    asOf: p.asOf ?? null,
  };
}

const rows: VectorUniverseRow[] = [
  row({ ticker: "AAA", spot: 100, gammaFlip: 101, topCallPct: 90, topPutPct: 10 }), // below, 1% to flip, strength 90
  row({ ticker: "BBB", spot: 100, gammaFlip: 99.8, topCallPct: 40, topPutPct: 30 }), // above, 0.2% to flip, strength 40
  row({ ticker: "CCC", spot: 100, gammaFlip: 90, topCallPct: 20, topPutPct: 55 }), // above, 10% to flip, strength 55
  row({ ticker: "ZZZ", spot: null, gammaFlip: null }), // no data
];

test("screenerRegimeOf / flipDistancePct / wallStrength: basic derivations", () => {
  assert.equal(screenerRegimeOf(rows[0]!), "below");
  assert.equal(screenerRegimeOf(rows[1]!), "above");
  assert.equal(screenerRegimeOf(rows[3]!), "unknown");
  assert.equal(Math.round(flipDistancePct(rows[0]!)! * 100) / 100, 1);
  assert.equal(wallStrength(rows[2]!), 55);
  assert.equal(flipDistancePct(rows[3]!), null);
});

test("preset nearest-flip: closest |flip distance| first, null-data row last", () => {
  const out = screenUniverse(rows, { preset: "nearest-flip" });
  assert.deepEqual(out.map((r) => r.ticker), ["BBB", "AAA", "CCC", "ZZZ"]);
  assert.equal(out[out.length - 1]!.ticker, "ZZZ", "no-data row sorts to the bottom");
});

test("preset most-pinned: only above-flip names, strongest wall first", () => {
  const out = screenUniverse(rows, { preset: "most-pinned" });
  // above-flip = BBB(40), CCC(55) → CCC first (55 > 40); AAA(below) and ZZZ excluded
  assert.deepEqual(out.map((r) => r.ticker), ["CCC", "BBB"]);
});

test("preset most-explosive: only below-flip names, nearest flip first", () => {
  const out = screenUniverse(rows, { preset: "most-explosive" });
  assert.deepEqual(out.map((r) => r.ticker), ["AAA"]); // only AAA is below flip
});

test("regime filter + wall-strength sort desc, nulls last", () => {
  const out = screenUniverse(rows, { regime: "all", sort: "wall-strength", dir: "desc" });
  assert.deepEqual(out.map((r) => r.ticker), ["AAA", "CCC", "BBB", "ZZZ"]);
});

test("default: ticker sort asc, never throws on empty", () => {
  assert.deepEqual(screenUniverse(rows).map((r) => r.ticker), ["AAA", "BBB", "CCC", "ZZZ"]);
  assert.deepEqual(screenUniverse([]), []);
});
