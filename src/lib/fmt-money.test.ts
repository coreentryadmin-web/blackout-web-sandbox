import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmtPremium } from "./fmt-money";

describe("fmt-money", () => {
  it("returns an em-dash for null/non-finite", () => {
    assert.equal(fmtPremium(null), "—");
    assert.equal(fmtPremium(NaN), "—");
    assert.equal(fmtPremium(Infinity), "—");
  });

  it("keeps sign outside the currency glyph", () => {
    assert.equal(fmtPremium(-1_200_000), "-$1.2M");
    assert.equal(fmtPremium(-4_100), "-$4.1K");
    assert.equal(fmtPremium(-50), "-$50");
  });

  it("checks billions before millions", () => {
    assert.equal(fmtPremium(5_000_000_000), "$5.0B");
    assert.equal(fmtPremium(1_200_000_000), "$1.2B");
  });

  it("formats millions to 1 decimal", () => {
    assert.equal(fmtPremium(38_200_000), "$38.2M");
  });

  it("keeps 1 decimal below $10K, whole K at/above $10K", () => {
    assert.equal(fmtPremium(1_400), "$1.4K");
    assert.equal(fmtPremium(9_900), "$9.9K");
    assert.equal(fmtPremium(22_100), "$22K");
    assert.equal(fmtPremium(456_700), "$457K");
  });

  it("formats sub-$1K as whole dollars", () => {
    assert.equal(fmtPremium(500), "$500");
    assert.equal(fmtPremium(0), "$0");
  });
});
