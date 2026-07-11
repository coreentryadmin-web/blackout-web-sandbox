import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreWallIntegrity, scoreTopWalls } from "./vector-wall-integrity";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { WallHistorySample } from "./vector-wall-history";

const walls: GexWalls = {
  callWalls: [
    { strike: 7600, pct: 100 },
    { strike: 7650, pct: 30 },
  ],
  putWalls: [
    { strike: 7500, pct: 55 },
    { strike: 7490, pct: 50 }, // near-equal → clustered / low isolation
  ],
};
// Strongest wall across both sides = the 7600 call at 100.
const REF = 100;

function sample(time: number, w: GexWalls): WallHistorySample {
  return { time, walls: w, gammaFlip: null };
}

// A rail where 7600 is present every sample (persistent), 7650 never.
const persistentHistory: WallHistorySample[] = Array.from({ length: 30 }, (_, i) =>
  sample(i, { callWalls: [{ strike: 7600, pct: 90 }], putWalls: [{ strike: 7500, pct: 50 }] })
);

test("scoreWallIntegrity: a dominant, all-session wall scores FIRM", () => {
  const r = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, persistentHistory, REF)!;
  assert.equal(r.tier, "firm");
  assert.ok(r.score >= 70, `score ${r.score} should be >=70`);
  assert.equal(r.factors.persistence, 1, "present in every rail sample");
  assert.equal(r.factors.strength, 1, "the strongest wall anchors strength at 1.0");
  assert.ok(r.factors.isolation >= 0.5, "towers over the 7650 wall");
  assert.match(r.note, /7600C firm — held 100% of session, dominant/);
});

test("REGRESSION: realistic small absolute pct — the dominant persistent wall is FIRM, not 'thin'", () => {
  // GEX pct is a wall's share of the WHOLE chain's gamma, so the top wall is only a
  // few % (here 6), not 100. The old `pct/100` made strength ~0.06 and a wall that
  // held all session still read "thin". Relative normalization fixes it.
  const realWalls: GexWalls = {
    callWalls: [
      { strike: 7600, pct: 6 },
      { strike: 7650, pct: 2 },
    ],
    putWalls: [{ strike: 7500, pct: 3 }],
  };
  const hist = Array.from({ length: 30 }, (_, i) =>
    sample(i, { callWalls: [{ strike: 7600, pct: 6 }], putWalls: [] })
  );
  const r = scoreTopWalls(realWalls, hist).call!;
  assert.equal(r.factors.strength, 1, "6%-of-chain top wall still normalizes to full strength");
  assert.equal(r.tier, "firm", "held-all-session dominant wall must NOT read thin");
  assert.ok(r.score >= 70, `score ${r.score} should be >=70`);
});

test("scoreWallIntegrity: a weaker, clustered wall is penalized vs the dominant one", () => {
  const putTop = scoreWallIntegrity(walls.putWalls[0]!, "put", walls.putWalls, persistentHistory, REF)!;
  const callTop = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, persistentHistory, REF)!;
  assert.ok(putTop.factors.isolation < 0.2, "put wall is clustered (7500 vs 7490)");
  assert.ok(putTop.factors.strength < callTop.factors.strength, "put (55/100) weaker than call (100/100)");
  assert.ok(putTop.score < callTop.score, "clustered/weaker wall must score below the dominant one");
});

test("scoreWallIntegrity: no history → persistence is neutral 0.5 (never fabricated as proven)", () => {
  const r = scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, [], REF)!;
  assert.equal(r.factors.persistence, 0.5);
  assert.match(r.note, /no rail yet/);
});

test("scoreWallIntegrity: single-wall side is fully isolated", () => {
  const one = scoreWallIntegrity({ strike: 7600, pct: 80 }, "call", [{ strike: 7600, pct: 80 }], [], 80);
  assert.equal(one!.factors.isolation, 1);
});

test("scoreWallIntegrity: null/garbage wall or zero ref → null/zero, never throws", () => {
  assert.equal(scoreWallIntegrity({ strike: 0, pct: 50 }, "call", [], [], REF), null);
  assert.equal(scoreWallIntegrity(undefined as never, "call", [], [], REF), null);
  const zeroRef = scoreWallIntegrity({ strike: 7600, pct: 5 }, "call", [{ strike: 7600, pct: 5 }], [], 0);
  assert.equal(zeroRef!.factors.strength, 0, "zero ref → strength 0, no divide-by-zero");
});

test("scoreTopWalls: returns the top call + top put, null side when absent", () => {
  const r = scoreTopWalls(walls, persistentHistory);
  assert.equal(r.call?.strike, 7600);
  assert.equal(r.put?.strike, 7500);
  const noPut = scoreTopWalls({ callWalls: walls.callWalls, putWalls: [] }, persistentHistory);
  assert.equal(noPut.put, null);
  assert.equal(scoreTopWalls(null).call, null);
});
