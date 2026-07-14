import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { stripGroundingTokens } from "@/lib/bie/grounding-markers";

describe("stripGroundingTokens (SPX + Vector desk answer rendering)", () => {
  test("renders {{value}} markers down to their values — nothing leaks", () => {
    // The exact leak the live audit caught on the SPX desk read.
    const raw = "LONG {{7,575}} {{0.00}}% below VWAP · MECHANIC above γflip {{7,496}} · grade {{A}} · RSI {{70}}";
    const out = stripGroundingTokens(raw);
    assert.ok(!out.includes("{{"), "no opening marker survives");
    assert.ok(!out.includes("}}"), "no closing marker survives");
    // The values themselves are preserved.
    for (const v of ["7,575", "0.00", "7,496", "A", "70"]) {
      assert.ok(out.includes(v), `value ${v} should survive`);
    }
  });

  test("is a no-op on text with no markers", () => {
    assert.equal(stripGroundingTokens("plain desk read, no markers"), "plain desk read, no markers");
  });

  test("handles the em-dash '{{—}}' placeholder", () => {
    assert.equal(stripGroundingTokens("flip {{—}}"), "flip —");
  });
});
