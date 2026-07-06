import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkNumbersGrounded, collectKnownNumbers, extractNumbersFromText, checkCommentaryGrounded, augmentKnownCommentaryNumbers } from "./grounding-guard";

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

  it("checkCommentaryGrounded allows rounded session metrics in the 10–999 band", () => {
    const known = augmentKnownCommentaryNumbers([43.712, 13.2, 6242, 6254]);
    const roundedIv = checkCommentaryGrounded("IV rank {{45}} (options pricey).", known);
    assert.equal(roundedIv.grounded, true);
    const roundedVix = checkCommentaryGrounded("VIX {{14}} (calm).", known);
    assert.equal(roundedVix.grounded, true);
    const ptDistance = checkCommentaryGrounded("R {{6254}} (+12, call wall).", [...known, 12]);
    assert.equal(ptDistance.grounded, true);
  });

  it("checkCommentaryGrounded ignores calendar years and indicator label tails", () => {
    const known = augmentKnownCommentaryNumbers([6242, 6254, 6220]);
    const year = checkCommentaryGrounded("NEWS  {{2026}} tariff headline quoted verbatim.", known);
    assert.equal(year.grounded, true);
    const emaLabel = checkCommentaryGrounded("WHY  Holding above ema200 cushion.", known);
    assert.equal(emaLabel.grounded, true);
  });

  it("checkCommentaryGrounded still rejects fabricated SPX strikes", () => {
    const known = augmentKnownCommentaryNumbers([6242, 6254, 6220]);
    const fake = checkCommentaryGrounded("Breakout toward {{6120}}.", known);
    assert.equal(fake.grounded, false);
    assert.equal(fake.ungroundedValue, 6120);
  });

  it("returns the first ungrounded value for diagnostics", () => {
    const result = checkNumbersGrounded("Levels at 745 (real) and 812 (fake).", [745]);
    assert.equal(result.grounded, false);
    assert.equal(result.ungroundedValue, 812);
  });
});

describe("grounding-guard: collectKnownNumbers", () => {
  it("walks nested objects and arrays for every finite number", () => {
    const ctx = {
      price_action: { price: 745, change_pct: 0.42, levels: [{ value: 760 }, { value: 730 }] },
      tags: ["neutral", 12],
      note: "not a number",
    };
    const known = collectKnownNumbers(ctx);
    for (const expected of [745, 0.42, 760, 730, 12]) {
      assert.ok(known.includes(expected), `expected ${expected} in collected numbers`);
    }
  });

  it("skips null/undefined/NaN and non-numeric leaves", () => {
    const ctx = { a: null, b: undefined, c: NaN, d: Infinity, e: "745", f: 745 };
    const known = collectKnownNumbers(ctx);
    assert.deepEqual(known, [745]);
  });

  it("returns an empty array for an empty context", () => {
    assert.deepEqual(collectKnownNumbers({}), []);
    assert.deepEqual(collectKnownNumbers(null), []);
  });

  it("combined: a commentary-style context grounds a narrative built only from its numbers", () => {
    const ctx = { price_action: { price: 745, vwap: 743 }, dealer_gex: { gamma_flip: 740, max_pain: 750 } };
    const known = collectKnownNumbers(ctx);
    const grounded = checkNumbersGrounded("Holding above VWAP 743, gamma flip at 740, max pain 750.", known);
    assert.equal(grounded.grounded, true);
    const hallucinated = checkNumbersGrounded("Next resistance sits at 812.", known);
    assert.equal(hallucinated.grounded, false);
    assert.equal(hallucinated.ungroundedValue, 812);
  });
});

describe("grounding-guard: extractNumbersFromText", () => {
  it("extracts numbers embedded in formatted strings, unfiltered", () => {
    const text = "Entry: $182.50/share, range 6020-6030, IV rank 62%, 3-day streak.";
    const known = extractNumbersFromText(text);
    for (const expected of [182.5, 6020, 6030, 62, 3]) {
      assert.ok(known.includes(expected), `expected ${expected} in extracted numbers`);
    }
  });

  it("returns an empty array when the text has no numbers", () => {
    assert.deepEqual(extractNumbersFromText("No levels here."), []);
  });

  it("combined: grounds a narrative against numbers pulled from a dossier-style text blob", () => {
    const dossierText = "Support at 6020, resistance at 6050. Flow streak 3 days. Entry $182.50/share.";
    const known = extractNumbersFromText(dossierText);
    const grounded = checkNumbersGrounded("Support holds at 6020 with resistance at 6050 above.", known);
    assert.equal(grounded.grounded, true);
    const hallucinated = checkNumbersGrounded("A breakout level at 6200 is in play.", known);
    assert.equal(hallucinated.grounded, false);
    assert.equal(hallucinated.ungroundedValue, 6200);
  });
});
