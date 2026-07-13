import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts, alertRuleId, ALERT_COOLDOWN_MS, type AlertRule, type AlertState } from "./vector-alerts";

const walls = { callWalls: [{ strike: 7600 }], putWalls: [{ strike: 7500 }] };
const wallRule: AlertRule = { id: "r-wall", ticker: "SPX", kind: "wall-touch", enabled: true }; // tol 0.1%
const flipRule: AlertRule = { id: "r-flip", ticker: "SPX", kind: "flip-cross", enabled: true };

test("wall-touch: fires ONCE on entering the band, silent while inside, re-arms after leaving + cooldown", () => {
  let st: AlertState = {};
  const tick = (spot: number, nowMs: number) => {
    const r = evaluateAlerts([wallRule], { spot, priorSpot: null, walls, flip: null, nowMs }, st);
    st = r.state;
    return r.fired;
  };

  assert.equal(tick(7575, 0).length, 0, "far from any wall → no fire");
  const f1 = tick(7599, 1000); // within 0.1% (7.6) of 7600
  assert.equal(f1.length, 1, "entering the band fires");
  assert.equal(f1[0]!.level, 7600);
  assert.equal(f1[0]!.kind, "wall-touch");

  assert.equal(tick(7601, 2000).length, 0, "still inside the band → no re-fire (armed cleared)");
  assert.equal(tick(7620, 3000).length, 0, "left the band → re-arms, but not touching now");
  assert.equal(tick(7599, 4000).length, 0, "touch again but within cooldown → suppressed");

  const f2 = tick(7599, 1000 + ALERT_COOLDOWN_MS + 1); // cooldown elapsed
  assert.equal(f2.length, 1, "fresh approach after cooldown fires again");
});

test("wall-touch: a DIFFERENT nearest wall after clearing fires as a new event", () => {
  let st: AlertState = {};
  const step = (spot: number, w: typeof walls, nowMs: number) => {
    const r = evaluateAlerts([wallRule], { spot, priorSpot: null, walls: w, flip: null, nowMs }, st);
    st = r.state; return r.fired;
  };
  assert.equal(step(7599, walls, 0).length, 1, "touch 7600");
  // Spot moves to the put wall region; nearest is now 7500 and spot is well outside 7600's exit band.
  const f = step(7501, walls, 1000 + ALERT_COOLDOWN_MS + 1);
  assert.equal(f.length, 1, "touching the OTHER wall is a distinct alert");
  assert.equal(f[0]!.level, 7500);
  assert.equal(f[0]!.direction, "down", "put-wall touch is a downside test");
});

test("flip-cross: fires on a genuine sign change, not while staying on one side; respects cooldown", () => {
  let st: AlertState = {};
  const tick = (spot: number, priorSpot: number | null, nowMs: number) => {
    const r = evaluateAlerts([flipRule], { spot, priorSpot, walls: null, flip: 7543, nowMs }, st);
    st = r.state; return r.fired;
  };

  assert.equal(tick(7550, null, 0).length, 0, "no prior spot → can't know a cross yet");
  const up = tick(7550, 7540, 1000); // 7540<flip, 7550>flip → crossed up
  assert.equal(up.length, 1);
  assert.equal(up[0]!.direction, "up");
  assert.equal(up[0]!.level, 7543);

  assert.equal(tick(7560, 7550, 2000).length, 0, "stayed above the flip → no fire");
  assert.equal(tick(7530, 7560, 3000).length, 0, "crossed back down but within cooldown → suppressed");
  const dn = tick(7530, 7550, 1000 + ALERT_COOLDOWN_MS + 1);
  assert.equal(dn.length, 1, "cross after cooldown fires");
  assert.equal(dn[0]!.direction, "down");
});

test("evaluateAlerts: disabled rules never fire; missing inputs are quiet, never throw", () => {
  const disabled: AlertRule = { ...wallRule, enabled: false };
  let st: AlertState = {};
  assert.equal(evaluateAlerts([disabled], { spot: 7599, priorSpot: null, walls, flip: 7543, nowMs: 0 }, st).fired.length, 0);

  // No walls → wall-touch can't fire; no flip / no priorSpot → flip-cross can't fire. No throw.
  assert.equal(evaluateAlerts([wallRule], { spot: 7600, priorSpot: null, walls: null, flip: null, nowMs: 0 }, st).fired.length, 0);
  assert.equal(evaluateAlerts([flipRule], { spot: 7600, priorSpot: null, walls, flip: null, nowMs: 0 }, st).fired.length, 0);
  // Bad spot → nothing fires.
  assert.equal(evaluateAlerts([wallRule, flipRule], { spot: 0, priorSpot: 7500, walls, flip: 7543, nowMs: 0 }, st).fired.length, 0);
});

test("alertRuleId: stable, human-readable, deterministic", () => {
  assert.equal(alertRuleId("SPX", "wall-touch", 3), "SPX:wall-touch:3");
  assert.equal(alertRuleId("NVDA", "flip-cross", 1), "NVDA:flip-cross:1");
});
