import { test } from "node:test";
import assert from "node:assert/strict";
// gamma-desk.ts has ZERO imports (no @/, no Next, no Redis) -> resolves cleanly
// under tsx --test. Both functions are pure/deterministic.
import { analyzeStrikeGexRows, computeGammaFlip, gammaRegime, gammaRegimeWithHysteresis, isAboveFlipFromRegime, topGexWalls } from "./gamma-desk";
import type { GexStrikeLevel } from "./gamma-desk";

test("balanced net-0 strike (callG=-putG) SURVIVES the filter", () => {
  const out = analyzeStrikeGexRows([
    { strike: 100, call_gamma_oi: 10, put_gamma_oi: 0 },
    { strike: 105, call_gamma_oi: 5, put_gamma_oi: -5 },
    { strike: 110, call_gamma_oi: 0, put_gamma_oi: -10 },
  ]);
  const balanced = out.ranked_levels.find((l) => l.strike === 105);
  assert.ok(balanced, "balanced strike 105 must not be dropped");
  assert.equal(balanced!.net_gex, 0);
});

test("true 0/0 empty strike is DROPPED", () => {
  const out = analyzeStrikeGexRows([
    { strike: 100, call_gamma_oi: 10, put_gamma_oi: 0 },
    { strike: 105, call_gamma_oi: 0, put_gamma_oi: 0 },
  ]);
  assert.equal(out.ranked_levels.find((l) => l.strike === 105), undefined);
});

test("balanced net-0 row is output-neutral for computeGammaFlip", () => {
  // A net-0 row adds 0 to the cumulative sum and can never be the selected flip
  // anchor: for [100:+10, 105:0, 110:-10] @ spot 106 the cum is 10 through 105
  // then hits 0 at 110 -> flip is 110. Dropping the balanced 105 row yields the
  // SAME flip (the real regression guard).
  const withBalanced = computeGammaFlip(
    [
      { strike: 100, net_gex: 10 },
      { strike: 105, net_gex: 0 },
      { strike: 110, net_gex: -10 },
    ],
    106
  );
  const withoutBalanced = computeGammaFlip(
    [
      { strike: 100, net_gex: 10 },
      { strike: 110, net_gex: -10 },
    ],
    106
  );
  assert.equal(withBalanced, 110);
  assert.equal(withBalanced, withoutBalanced);
});

test("sign-change interpolation unaffected (cumulative crosses zero)", () => {
  // cum: 8 at 100, then 8 + (-12) = -4 at 110 -> crosses zero -> interpolate
  // flip = 100 + (8/12)*10 = 106.67, strictly within (100, 110).
  const flip = computeGammaFlip(
    [
      { strike: 100, net_gex: 8 },
      { strike: 110, net_gex: -12 },
    ],
    104
  );
  assert.ok(flip !== null && flip > 100 && flip < 110, "flip interpolates within (100,110)");
});

test("empty / insufficient input", () => {
  const out = analyzeStrikeGexRows([]);
  assert.deepEqual(out.ranked_levels, []);
  assert.equal(out.gex_king_strike, null);
  assert.equal(computeGammaFlip([], 100), null);
});

// --- topGexWalls: balanced two-sided ladder (bug #93) ------------------------

const lvl = (strike: number, net_gex: number): GexStrikeLevel => ({
  strike,
  net_gex,
  call_gex: net_gex > 0 ? net_gex : 0,
  put_gex: net_gex < 0 ? net_gex : 0,
});

test("negative-gamma day still surfaces the call wall (the put-only bug)", () => {
  // Spot 7354. Near-spot strikes are all put-dominated (negative net_gex) on this day;
  // the real call wall (largest positive net_gex) sits well above at 7400. The old
  // proximity-only selection dropped it entirely → 6 PUT rows. It must now appear.
  const spot = 7354;
  const levels = [
    lvl(7340, -900),
    lvl(7345, -1200),
    lvl(7350, -1500),
    lvl(7355, -800),
    lvl(7360, -600),
    lvl(7365, -400),
    lvl(7400, 700), // <- the call wall: only positive-net_gex strike, far above spot
  ];
  const walls = topGexWalls(levels, spot, 10);
  const callWall = walls.find((w) => w.net_gex > 0);
  assert.ok(callWall, "call wall (positive net_gex) must be present");
  assert.equal(callWall!.strike, 7400);
  assert.ok(
    walls.some((w) => w.net_gex < 0),
    "put wall (negative net_gex) must also be present"
  );
});

test("guaranteed #1 call wall = max positive net_gex, #1 put wall = max negative", () => {
  const spot = 5000;
  const levels = [
    lvl(5100, 300),
    lvl(5150, 900), // <- max positive => call wall
    lvl(4900, -200),
    lvl(4850, -1100), // <- max negative => put wall
  ];
  const walls = topGexWalls(levels, spot, 10);
  const call = walls.filter((w) => w.net_gex > 0).sort((a, b) => b.net_gex - a.net_gex)[0];
  const put = walls.filter((w) => w.net_gex < 0).sort((a, b) => a.net_gex - b.net_gex)[0];
  assert.equal(call.strike, 5150);
  assert.equal(put.strike, 4850);
});

test("kind stays GEOMETRIC (strike vs spot), not net_gex sign", () => {
  // A negative-net_gex strike ABOVE spot is geometrically resistance (contract the
  // verdict engine + recalcGexWallDistances rely on); the component re-labels it as a
  // put wall by sign and notes the acting-as role.
  const walls = topGexWalls([lvl(5100, -500), lvl(4900, 500)], 5000, 10);
  const above = walls.find((w) => w.strike === 5100)!;
  const below = walls.find((w) => w.strike === 4900)!;
  assert.equal(above.kind, "resistance");
  assert.equal(below.kind, "support");
});

test("honest fallback: fully put-dominated chain yields NO positive-net_gex wall", () => {
  // No positive net_gex anywhere → no call wall is invented (grounded). The component
  // shows the put-only ladder + a "fully put-dominated" note.
  const walls = topGexWalls([lvl(5100, -300), lvl(4950, -800), lvl(4900, -500)], 5000, 10);
  assert.ok(walls.length > 0);
  assert.ok(!walls.some((w) => w.net_gex > 0), "must not fabricate a call wall");
});

test("ladder is sorted descending by strike (calls above, puts below)", () => {
  const spot = 5000;
  const walls = topGexWalls(
    [lvl(5100, 400), lvl(5050, 200), lvl(4950, -300), lvl(4900, -600)],
    spot,
    10
  );
  for (let i = 1; i < walls.length; i++) {
    assert.ok(walls[i - 1].strike >= walls[i].strike, "strikes descend");
  }
});

test("topGexWalls: respects small limit even when both anchors exist", () => {
  const spot = 5000;
  const walls = topGexWalls(
    [lvl(5100, 400), lvl(5050, 200), lvl(4950, -300), lvl(4900, -600)],
    spot,
    1
  );
  assert.equal(walls.length, 1);
});

test("empty levels or spot<=0 returns []", () => {
  assert.deepEqual(topGexWalls([], 5000, 10), []);
  assert.deepEqual(topGexWalls([lvl(5000, 100)], 0, 10), []);
});

test("gammaRegimeWithHysteresis: holds prior regime until buffer cleared", () => {
  const flip = 6000;
  assert.equal(gammaRegime(6001, flip), "mean_revert");
  assert.equal(gammaRegimeWithHysteresis(6001, flip, "amplification"), "amplification");
  assert.equal(gammaRegimeWithHysteresis(6003, flip, "amplification"), "mean_revert");
  assert.equal(gammaRegimeWithHysteresis(5999, flip, "mean_revert"), "mean_revert");
  assert.equal(gammaRegimeWithHysteresis(5997, flip, "mean_revert"), "amplification");
});

test("gammaRegimeWithHysteresis: stays a pure spot-vs-flip model — no aggregate net-GEX override", () => {
  const flip = 6000;
  // Spot just BELOW the flip is LOCALLY short-gamma (amplification) regardless of the total-book net
  // GEX sign — the local regime at spot and the aggregate net sign measure different things, so the
  // label must NOT flip to mean_revert just because the book is net long. (Adversarial-refuted
  // override; see FINDINGS.) The function takes no netGex arg by design.
  assert.equal(gammaRegimeWithHysteresis(5999, flip, "amplification"), "amplification");
  assert.equal(gammaRegimeWithHysteresis(6001, flip, "mean_revert"), "mean_revert");
});

// ── SINGLE SIDE-OF-FLIP TRUTH (fix/spx-slayer-desk-coherence) ───────────────
// Root-cause regression guard: `above_gamma_flip` used to be a raw `price > flip` compare while
// `gamma_regime` used gammaRegimeWithHysteresis (2pt buffer). Inside the band the two STRADDLED —
// side said "above" while the regime label (and the synthesis narration / confluence signal /
// regime-route posture that key off it) said short-γ amplification (below). The fix derives the side
// from the SAME regime label via isAboveFlipFromRegime, so the invariant
// `above_gamma_flip === (gamma_regime === "mean_revert")` holds for EVERY snapshot — including the
// two prices inside the hysteresis band that used to disagree.
test("isAboveFlipFromRegime: mean_revert=above, amplification/unknown=not-above", () => {
  assert.equal(isAboveFlipFromRegime("mean_revert"), true);
  assert.equal(isAboveFlipFromRegime("amplification"), false);
  assert.equal(isAboveFlipFromRegime("unknown"), false);
});

test("side-of-flip stays coherent with the hysteresis regime INSIDE the 2pt band (both sides)", () => {
  const flip = 7500;

  // Dip 1pt below the flip while previously above (mean_revert). Hysteresis holds the regime at
  // mean_revert (needs spot <= flip-2 to flip to amplification). The derived side must therefore be
  // ABOVE — matching the regime — even though a RAW price>flip compare would say BELOW.
  const regimeDown = gammaRegimeWithHysteresis(7499, flip, "mean_revert");
  assert.equal(regimeDown, "mean_revert", "hysteresis preserved: stays mean_revert inside the band");
  const sideDown = isAboveFlipFromRegime(regimeDown);
  assert.equal(sideDown, true, "side agrees with the regime (above), not the raw compare");
  assert.notEqual(sideDown, 7499 > flip, "the OLD raw-compare bug: side would have disagreed here");
  assert.equal(sideDown, regimeDown === "mean_revert", "invariant: above === (regime===mean_revert)");

  // Tick 1pt above the flip while previously below (amplification). Hysteresis holds amplification
  // (needs spot >= flip+2). Derived side must be NOT-above — matching the regime — though a raw
  // compare would say above.
  const regimeUp = gammaRegimeWithHysteresis(7501, flip, "amplification");
  assert.equal(regimeUp, "amplification", "hysteresis preserved: stays amplification inside the band");
  const sideUp = isAboveFlipFromRegime(regimeUp);
  assert.equal(sideUp, false, "side agrees with the regime (below), not the raw compare");
  assert.notEqual(sideUp, 7501 > flip, "the OLD raw-compare bug: side would have disagreed here");
  assert.equal(sideUp, regimeUp === "mean_revert", "invariant: above === (regime===mean_revert)");
});
