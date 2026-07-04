import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkNumbersGrounded } from "./grounding-guard";

describe("grounding-guard", () => {
  it("passes when known is empty (nothing to check against)", () => {
    const result = checkNumbersGrounded("Price is holding near 745.", []);
    assert.equal(result.grounded, true);
    assert.equal(result.ungroundedValue, null);
  });

  it("passes when a cited level matches a known level within tolerance", () => {
    const result = checkNumbersGrounded("Price is holding near 745 with resistance at 760.", [745, 760, 730]);
    assert.equal(result.grounded, true);
  });

  it("flags a hallucinated level absent from the known set", () => {
    const result = checkNumbersGrounded("Resistance sits at 812, a level nobody has quoted.", [730, 745, 760]);
    assert.equal(result.grounded, false);
    assert.equal(result.ungroundedValue, 812);
  });

  it("ignores percentages", () => {
    const result = checkNumbersGrounded("Up 0.42% on the day, holding above 745.", [745]);
    assert.equal(result.grounded, true);
  });

  it("ignores explicit money magnitudes", () => {
    const result = checkNumbersGrounded("Net GEX is $688M with dealers long above 745.", [745]);
    assert.equal(result.grounded, true);
  });

  it("ignores money magnitudes with a decimal and B/M/K suffix", () => {
    const result = checkNumbersGrounded("Net GEX -$1.2B, dealers short below 745.", [745]);
    assert.equal(result.grounded, true);
  });

  it("ignores small integers under 10", () => {
    const result = checkNumbersGrounded("3 to 5 sentences, 0DTE flow building above 745.", [745]);
    assert.equal(result.grounded, true);
  });

  it("ignores numbers wildly outside the known band", () => {
    const result = checkNumbersGrounded("Filed in 2026, price near 745.", [700, 745, 790]);
    assert.equal(result.grounded, true);
  });

  it("respects tolerance scaling with magnitude", () => {
    // 745.3 is within ~0.15%/half-point tolerance of 745.
    const closeEnough = checkNumbersGrounded("Pin near 745.3.", [745]);
    assert.equal(closeEnough.grounded, true);
    // 747 is outside tolerance of 745 and not itself a known level.
    const tooFar = checkNumbersGrounded("Pin near 747.", [745]);
    assert.equal(tooFar.grounded, false);
  });

  it("returns the first ungrounded value for diagnostics", () => {
    const result = checkNumbersGrounded("Levels at 745 (real) and 812 (fake).", [745]);
    assert.equal(result.grounded, false);
    assert.equal(result.ungroundedValue, 812);
  });
});
