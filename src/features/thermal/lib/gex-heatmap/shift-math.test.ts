import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shiftPercentForStrike } from "./shift-math";

describe("shiftPercentForStrike", () => {
  it("computes a positive percent when the value built", () => {
    // baseline 1_000_000 -> current 1_500_000 (delta +500_000): built +50%
    assert.equal(shiftPercentForStrike(1_500_000, 500_000), 50);
  });

  it("computes a NEGATIVE percent when the value melted, even from a negative baseline", () => {
    // baseline -1_000_000 -> current -1_500_000 (delta -500_000): melted further, -50%
    // (dividing by |baseline| keeps the sign tied to delta, not baseline's own sign)
    assert.equal(shiftPercentForStrike(-1_500_000, -500_000), -50);
  });

  it("computes a POSITIVE percent when a negative position built back toward zero", () => {
    // baseline -1_000_000 -> current -500_000 (delta +500_000): this "built" (less negative)
    // and should read +50%, not the confusing -50% a bare delta/baseline would give.
    assert.equal(shiftPercentForStrike(-500_000, 500_000), 50);
  });

  it("returns null when there is no delta", () => {
    assert.equal(shiftPercentForStrike(1_000_000, null), null);
    assert.equal(shiftPercentForStrike(1_000_000, undefined), null);
  });

  it("returns null (never Infinity/NaN) when the baseline is ~zero", () => {
    assert.equal(shiftPercentForStrike(500, 500), null); // baseline = 0
    assert.equal(shiftPercentForStrike(500.4, 500), null); // baseline = 0.4, floored out
  });

  it("returns null on non-finite inputs", () => {
    assert.equal(shiftPercentForStrike(NaN, 100), null);
    assert.equal(shiftPercentForStrike(100, Infinity), null);
  });
});
