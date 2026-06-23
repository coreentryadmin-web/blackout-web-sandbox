import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGammaFlip } from "./gamma-desk";

// P3 fix: a flip requires the cumulative GEX to actually CHANGE SIGN, not merely
// touch zero. These guard the zero-touch correction without re-running a far-from-spot
// tangent as a flip. (Keep the existing gamma-desk.test.ts 4 assertions passing too.)

test("tangent zero-touch is NOT a flip (cum +10 -> 0 -> +10)", () => {
  const levels = [
    { strike: 100, net_gex: 10 },
    { strike: 110, net_gex: -10 },
    { strike: 120, net_gex: 10 },
  ];
  assert.equal(computeGammaFlip(levels, 109), null);
});

test("crossing through exact zero IS a flip (cum +10 -> 0 -> -5)", () => {
  const levels = [
    { strike: 100, net_gex: 10 },
    { strike: 110, net_gex: -10 },
    { strike: 120, net_gex: -5 },
  ];
  assert.equal(computeGammaFlip(levels, 300), 110);
});

test("genuine non-zero sign change still interpolates within the bracket", () => {
  const levels = [
    { strike: 100, net_gex: 10 },
    { strike: 110, net_gex: -20 },
  ];
  const flip = computeGammaFlip(levels, 105);
  assert.ok(flip !== null && flip > 100 && flip < 110);
});

test("empty input returns null", () => {
  assert.equal(computeGammaFlip([], 100), null);
});
