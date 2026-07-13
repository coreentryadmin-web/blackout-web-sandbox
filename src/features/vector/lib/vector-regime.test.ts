import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveVectorRegime } from "./vector-regime";

test("long gamma: spot above flip → calm, range-bound read with levels", () => {
  const r = deriveVectorRegime({ spot: 7575, gammaFlip: 7495, topCallWall: 7600, topPutWall: 7500 });
  assert.equal(r.posture, "long");
  assert.equal(r.headline, "LONG GAMMA");
  assert.equal(r.tone, "calm");
  assert.match(r.read, /above the gamma flip/);
  assert.match(r.read, /resistance 7,600/);
  assert.match(r.read, /support 7,500/);
});

test("short gamma: spot below flip → volatile, momentum read", () => {
  const r = deriveVectorRegime({ spot: 7450, gammaFlip: 7495, topCallWall: 7500, topPutWall: 7400 });
  assert.equal(r.posture, "short");
  assert.equal(r.headline, "SHORT GAMMA");
  assert.equal(r.tone, "volatile");
  assert.match(r.read, /below the gamma flip/);
  assert.match(r.read, /accelerate/);
});

test("transition: spot within 0.1% of flip → undecided, volatile", () => {
  const r = deriveVectorRegime({ spot: 7500, gammaFlip: 7497, topCallWall: 7550, topPutWall: 7450 });
  assert.equal(r.posture, "transition");
  assert.equal(r.tone, "volatile");
  assert.match(r.read, /sitting on the gamma flip/);
});

test("just outside the transition band commits to a posture", () => {
  // 0.2% below flip → short, not transition.
  const r = deriveVectorRegime({ spot: 7480, gammaFlip: 7495 });
  assert.equal(r.posture, "short");
});

test("missing/invalid data → unknown, neutral (never fabricates a regime)", () => {
  for (const bad of [
    { spot: null, gammaFlip: 7495 },
    { spot: 7500, gammaFlip: null },
    { spot: 0, gammaFlip: 7495 },
    { spot: 7500, gammaFlip: -1 },
    { spot: NaN, gammaFlip: 7495 },
  ]) {
    const r = deriveVectorRegime(bad as { spot: number | null; gammaFlip: number | null });
    assert.equal(r.posture, "unknown");
    assert.equal(r.tone, "neutral");
  }
});

test("levels are optional — read omits them cleanly when walls absent", () => {
  const r = deriveVectorRegime({ spot: 7575, gammaFlip: 7495 });
  assert.equal(r.posture, "long");
  assert.doesNotMatch(r.read, /resistance|support/);
});

test("NaN wall level is OMITTED, never rendered as 'NaN' (AAPL banner bug from 10-ticker sweep)", () => {
  const r = deriveVectorRegime({ spot: 316, gammaFlip: 310, topCallWall: 320, topPutWall: NaN });
  assert.match(r.read, /resistance 320/);
  assert.doesNotMatch(r.read, /NaN/);
  assert.doesNotMatch(r.read, /support/);
  // Both NaN → no levels clause at all.
  const r2 = deriveVectorRegime({ spot: 316, gammaFlip: 310, topCallWall: NaN, topPutWall: NaN });
  assert.doesNotMatch(r2.read, /NaN|resistance|support/);
});
