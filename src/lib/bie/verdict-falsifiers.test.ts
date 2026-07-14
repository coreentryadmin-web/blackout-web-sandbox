import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  deriveFalsifiers,
  evaluateFalsifier,
  reevaluateCase,
  type FalsifierEvidence,
  type FalsifierSnapshot,
} from "@/lib/bie/verdict-falsifiers";
import type { BieFalsifier } from "@/lib/bie/answer-envelope";

const longEv: FalsifierEvidence = {
  spot: 7515,
  flip: 7480,
  call_wall: 7550,
  put_wall: 7400,
  max_pain: 7500,
  regime: "long",
};

describe("verdict-falsifiers: deriveFalsifiers", () => {
  test("long-side read (spot above flip) → flip-LOSS invalidator + call-wall-migration weakener + max-pain weakener", () => {
    const f = deriveFalsifiers(longEv, "bullish");
    const ids = f.map((x) => x.id);
    assert.ok(ids.includes("flip_loss"), "has flip-loss invalidator");
    const flip = f.find((x) => x.id === "flip_loss")!;
    assert.equal(flip.effect, "invalidate");
    assert.equal(flip.op, "crosses_below");
    assert.equal(flip.refLevel, 7480);
    assert.match(flip.text, /below the 7,480 gamma flip/);
    assert.ok(ids.includes("call_wall_migrates_below_spot"), "call wall migration weakener");
    assert.equal(f.find((x) => x.id === "call_wall_migrates_below_spot")!.effect, "weaken");
    assert.ok(ids.includes("max_pain_crosses_below_flip"), "max-pain migration weakener");
  });

  test("short-side read (spot below flip) → flip-RECLAIM invalidator, phrased against the short side", () => {
    const shortEv: FalsifierEvidence = { ...longEv, spot: 7460, regime: "short" };
    const f = deriveFalsifiers(shortEv, "bearish");
    const flip = f.find((x) => x.id === "flip_reclaim")!;
    assert.ok(flip, "has flip-reclaim invalidator");
    assert.equal(flip.op, "crosses_above");
    assert.match(flip.text, /reclaims above/);
    // Bearish read → put-wall migration weakener (put wall below spot here: 7400 < 7460).
    assert.ok(f.some((x) => x.id === "put_wall_migrates_above_spot"));
  });

  test("no boilerplate: a falsifier is only emitted for a level that is actually live", () => {
    const thin: FalsifierEvidence = { spot: 7515, flip: null, call_wall: null, put_wall: null, max_pain: null, regime: "unknown" };
    assert.deepEqual(deriveFalsifiers(thin, "neutral"), []);
  });
});

describe("verdict-falsifiers: evaluateFalsifier (the pure interpreter)", () => {
  const spec: BieFalsifier = {
    id: "flip_loss",
    effect: "invalidate",
    metric: "spot",
    op: "crosses_below",
    refLevel: 7480,
    text: "INVALIDATED if spot closes below the 7,480 gamma flip.",
  };
  const baseline: FalsifierSnapshot = { spot: 7515, flip: 7480, call_wall: 7550, put_wall: 7400, max_pain: 7500 };

  test("crosses_below trips only when it actually crossed (was above → now below)", () => {
    const now: FalsifierSnapshot = { ...baseline, spot: 7470 };
    const r = evaluateFalsifier(spec, baseline, now);
    assert.equal(r.triggered, true);
    assert.equal(r.status, "invalidated");
  });

  test("crosses_below holds when spot stays above the level", () => {
    const now: FalsifierSnapshot = { ...baseline, spot: 7520 };
    const r = evaluateFalsifier(spec, baseline, now);
    assert.equal(r.triggered, false);
    assert.equal(r.status, "holding");
  });

  test("indeterminate when the watched metric is not live now (never guessed)", () => {
    const now: FalsifierSnapshot = { ...baseline, spot: null };
    const r = evaluateFalsifier(spec, baseline, now);
    assert.equal(r.status, "indeterminate");
    assert.equal(r.triggered, false);
  });

  test("migrates_below_spot trips when the wall falls to/under spot", () => {
    const wallSpec: BieFalsifier = {
      id: "cw", effect: "weaken", metric: "call_wall", op: "migrates_below_spot", refLevel: 7550,
      text: "WEAKENED if the call wall migrates below spot.",
    };
    const now: FalsifierSnapshot = { ...baseline, spot: 7560, call_wall: 7555 }; // wall now below spot
    assert.equal(evaluateFalsifier(wallSpec, baseline, now).triggered, true);
    const stillAbove: FalsifierSnapshot = { ...baseline, spot: 7515, call_wall: 7550 };
    assert.equal(evaluateFalsifier(wallSpec, baseline, stillAbove).triggered, false);
  });
});

describe("verdict-falsifiers: reevaluateCase rollup", () => {
  test("any invalidator tripped → overall invalidated; else weakened; else holds", () => {
    const f = deriveFalsifiers(longEv, "bullish");
    const base: FalsifierSnapshot = { spot: 7515, flip: 7480, call_wall: 7550, put_wall: 7400, max_pain: 7500 };
    // Unchanged → holds.
    assert.equal(reevaluateCase(f, base, base).overall, "holds");
    // Spot loses the flip → invalidated (dominates).
    assert.equal(reevaluateCase(f, base, { ...base, spot: 7460 }).overall, "invalidated");
    // Only the call wall migrates below spot → weakened.
    assert.equal(reevaluateCase(f, base, { ...base, spot: 7560, call_wall: 7555 }).overall, "weakened");
  });
});
