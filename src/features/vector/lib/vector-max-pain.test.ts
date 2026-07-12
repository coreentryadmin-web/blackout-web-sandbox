import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMaxPain, type MaxPainContract } from "./vector-max-pain";

/** Build a symmetric call+put chain with the same OI at each strike. */
function symChain(strikes: number[], oi: number): MaxPainContract[] {
  return strikes.flatMap((strike) => [
    { strike, type: "call" as const, openInterest: oi },
    { strike, type: "put" as const, openInterest: oi },
  ]);
}

test("computeMaxPain: symmetric chain pins to the middle strike", () => {
  const res = computeMaxPain(symChain([100, 110, 120], 10));
  assert.ok(res);
  assert.equal(res.maxPain, 110);
  // Hand-computed payout at P=110: one call ITM (110−100)·10·100 = 10000; one put ITM
  // (120−110)·10·100 = 10000; total 20000 — the minimum vs 30000 at either wing.
  const p110 = res.points.find((p) => p.strike === 110)!;
  assert.equal(p110.callCash, 10000);
  assert.equal(p110.putCash, 10000);
  assert.equal(p110.totalCash, 20000);
  const p100 = res.points.find((p) => p.strike === 100)!;
  assert.equal(p100.totalCash, 30000);
  assert.equal(res.points.find((p) => p.strike === 120)!.totalCash, 30000);
});

test("computeMaxPain: skewed OI pulls max pain toward the heavy side", () => {
  // Heavy call OI stacked low + heavy put OI stacked high both drag pain toward the middle-low; a
  // big put wall at 120 makes settling low cheap for writers → pain sits where their payout is least.
  const chain: MaxPainContract[] = [
    { strike: 90, type: "call", openInterest: 100 },
    { strike: 100, type: "call", openInterest: 50 },
    { strike: 110, type: "put", openInterest: 10 },
    { strike: 120, type: "put", openInterest: 10 },
  ];
  const res = computeMaxPain(chain)!;
  // Candidate totals (÷100 for readability): P=90 → puts (110−90)·10+(120−90)·10=500;
  // P=100 → calls (100−90)·100=1000 + puts (110−100)·10+(120−100)·10=300 → 1300;
  // P=110 → calls (110−90)·100+(110−100)·50=2500 + puts (120−110)·10=100 → 2600;
  // P=120 → calls (120−90)·100+(120−100)·50=4000. Min is P=90.
  assert.equal(res.maxPain, 90);
});

test("computeMaxPain: ties on the minimum resolve to the lower strike", () => {
  // One call at 100, one put at 110: P=100 and P=110 both cost writers 10·10·100 = 10000.
  const chain: MaxPainContract[] = [
    { strike: 100, type: "call", openInterest: 10 },
    { strike: 110, type: "put", openInterest: 10 },
  ];
  const res = computeMaxPain(chain)!;
  assert.equal(res.points.find((p) => p.strike === 100)!.totalCash, 10000);
  assert.equal(res.points.find((p) => p.strike === 110)!.totalCash, 10000);
  assert.equal(res.maxPain, 100); // lower strike on tie
});

test("computeMaxPain: single strike is its own max pain (zero intrinsic there)", () => {
  const res = computeMaxPain([
    { strike: 500, type: "call", openInterest: 1 },
    { strike: 500, type: "put", openInterest: 1 },
  ])!;
  assert.equal(res.maxPain, 500);
  assert.equal(res.points.length, 1);
  assert.equal(res.points[0]!.totalCash, 0);
});

test("computeMaxPain: ignores non-positive OI and non-finite strikes; null when nothing usable", () => {
  assert.equal(computeMaxPain([]), null);
  assert.equal(computeMaxPain([{ strike: 100, type: "call", openInterest: 0 }]), null);
  assert.equal(computeMaxPain([{ strike: NaN, type: "put", openInterest: 5 }]), null);
  // A zero-OI decoy strike must not become a candidate.
  const res = computeMaxPain([
    { strike: 100, type: "call", openInterest: 10 },
    { strike: 105, type: "call", openInterest: 0 },
    { strike: 110, type: "put", openInterest: 10 },
  ])!;
  assert.ok(!res.points.some((p) => p.strike === 105), "zero-OI strike excluded");
  assert.deepEqual(res.points.map((p) => p.strike), [100, 110]);
});

test("computeMaxPain: points are ascending by strike and cover every positive-OI strike once", () => {
  const res = computeMaxPain(symChain([120, 100, 110], 3))!;
  assert.deepEqual(res.points.map((p) => p.strike), [100, 110, 120]);
});
