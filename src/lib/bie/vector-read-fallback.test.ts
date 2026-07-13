import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  namesUnsupportedHorizon,
  unsupportedHorizonMessage,
  noLiveVectorStateMessage,
} from "@/lib/bie/vector-read-fallback";
import { classifyBieIntent } from "@/lib/bie/router";

const NO_LEDGER = new Set<string>();

describe("vector honesty: unsupported horizon", () => {
  test("namesUnsupportedHorizon flags LEAP / multi-year / quarterly / multi-month", () => {
    for (const q of [
      "SPX 3-year LEAP flip",
      "show me the LEAPS walls on NVDA",
      "SPY 2 year gamma flip",
      "annual max pain for SPX",
      "quarterly SPX structure",
      "6 month SPY walls",
      "multi-year flip",
    ]) {
      assert.equal(namesUnsupportedHorizon(q), true, `unsupported: ${q}`);
    }
  });

  test("the SUPPORTED horizons (0DTE / weekly / monthly / all) are NOT flagged", () => {
    for (const q of [
      "SPX 0DTE flip",
      "SPY weekly walls",
      "NVDA monthly max pain",
      "SPX whole chain flip",
      "SPX 1 month flip", // ~monthly, supported
      "what's the SPX setup right now",
    ]) {
      assert.equal(namesUnsupportedHorizon(q), false, `supported: ${q}`);
    }
  });

  test("the honest messages name the real supported horizons and never fabricate a number", () => {
    const m = unsupportedHorizonMessage("SPX");
    assert.match(m, /SPX/);
    assert.match(m, /0DTE, weekly, monthly, or the full chain/i);
    assert.doesNotMatch(m, /\d{3,}/); // no fabricated price/level
    assert.match(noLiveVectorStateMessage("ZZZZ"), /ZZZZ/);
  });

  test("router sends an unsupported-horizon question to the Vector composer (which rejects it honestly)", () => {
    // SPX LEAP structure would otherwise hit the SPX desk and answer the aggregate as the LEAP.
    const r = classifyBieIntent("SPX 3-year LEAP gamma flip", NO_LEDGER);
    assert.equal(r?.intent, "vector_read");
    assert.equal(r?.ticker, "SPX");
    // A named ticker is carried through so the honest message references it.
    assert.equal(classifyBieIntent("NVDA LEAPS walls", NO_LEDGER)?.ticker, "NVDA");
  });

  test("BOUNDARY: a normal weekly SPX question is NOT swallowed by the unsupported-horizon guard", () => {
    // The weekly ask is a supported horizon → the guard doesn't fire, so it is not forced onto the
    // honest-reject vector path (it keeps whatever normal SPX/Vector route it already had).
    assert.equal(namesUnsupportedHorizon("SPX weekly flip"), false);
    assert.notEqual(classifyBieIntent("SPX weekly flip", NO_LEDGER), null);
    // "what is a LEAP" is a DEFINITION (concept), not a horizon request → not the reject path.
    assert.equal(classifyBieIntent("what is a LEAP", NO_LEDGER)?.intent, "concept_read");
  });
});
