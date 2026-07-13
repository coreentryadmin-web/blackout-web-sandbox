import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { classifyBieIntent, classifyBieStagingFallback, bieFollowups } from "@/lib/bie/router";

const NO_LEDGER = new Set<string>();

describe("router: vector_read intent", () => {
  test("explicit 'vector' mention routes to vector_read for the named ticker", () => {
    const r = classifyBieIntent("what's the vector setup on NVDA right now", NO_LEDGER);
    assert.equal(r?.intent, "vector_read");
    assert.equal(r?.ticker, "NVDA");
    assert.equal(r?.horizon, "all");
  });

  test("explicit 'vector' with SPX still routes to vector_read (Vector wins over SPX Sniper when named)", () => {
    const r = classifyBieIntent("show me the vector desk for SPX", NO_LEDGER);
    assert.equal(r?.intent, "vector_read");
    assert.equal(r?.ticker, "SPX");
  });

  test("Vector-shaped question about a NON-SPX ticker routes to vector_read — NOT the SPX desk", () => {
    // The exact class the live audit missed: "QQQ 15m technicals" fell to the SPX dump.
    const r = classifyBieIntent("QQQ 15m technicals", NO_LEDGER);
    assert.equal(r?.intent, "vector_read");
    assert.equal(r?.ticker, "QQQ");
  });

  test("horizon is parsed from the question (weekly)", () => {
    const r = classifyBieIntent("SPY weekly gamma flip and walls", NO_LEDGER);
    assert.equal(r?.intent, "vector_read");
    assert.equal(r?.ticker, "SPY");
    assert.equal(r?.horizon, "weekly");
  });

  test("horizon is parsed from the question (0dte)", () => {
    const r = classifyBieIntent("where's the gamma flip on NVDA 0DTE", NO_LEDGER);
    assert.equal(r?.intent, "vector_read");
    assert.equal(r?.horizon, "0dte");
  });

  test("bead/VEX/dark-pool concepts on a non-SPX ticker route to vector_read", () => {
    assert.equal(classifyBieIntent("which walls are building or fading on ASTS", NO_LEDGER)?.intent, "vector_read");
    assert.equal(classifyBieIntent("where's the VEX flip on SPY", NO_LEDGER)?.intent, "vector_read");
    assert.equal(classifyBieIntent("dark pool levels for NVDA", NO_LEDGER)?.intent, "vector_read");
  });

  test("a bare SPX gamma question (no 'vector') is NOT stolen by vector_read — SPX keeps its own desk", () => {
    const r = classifyBieIntent("where's the SPX gamma flip", NO_LEDGER);
    assert.notEqual(r?.intent, "vector_read");
  });

  test("staging fallback routes Vector-shaped questions to vector_read, not the SPX default", () => {
    assert.equal(classifyBieStagingFallback("vector read on QQQ").intent, "vector_read");
    assert.equal(classifyBieStagingFallback("NVDA expected move and walls").intent, "vector_read");
    // Explicit vector + SPX still vector_read (not the SPX desk default).
    assert.equal(classifyBieStagingFallback("vector desk for SPX").intent, "vector_read");
  });

  test("bieFollowups has a vector_read branch", () => {
    const f = bieFollowups("vector_read");
    assert.ok(Array.isArray(f) && f.length === 3);
  });
});

describe("router: concept_read intent", () => {
  test("definitional questions route to concept_read", () => {
    for (const q of [
      "what is GEX",
      "what is a King node",
      "define the gamma flip",
      "explain a call wall",
      "what does Night Hawk do",
      "what is max pain",
      "what is VEX",
      "tell me about wall integrity",
      "what is Vector", // the PRODUCT — not a live vector read
      "what is Largo",
    ]) {
      assert.equal(classifyBieIntent(q, NO_LEDGER)?.intent, "concept_read", `expected concept for: ${q}`);
    }
  });

  test("unknown definitional term still routes to concept_read (honest miss + gap-log, not a dump)", () => {
    assert.equal(classifyBieIntent("what is the flongle indicator", NO_LEDGER)?.intent, "concept_read");
  });

  test("BOUNDARY: a NUMERIC question naming a ticker is NOT stolen by concept_read", () => {
    // "what is the SPX flip" is a live number → SPX desk, not a definition.
    assert.notEqual(classifyBieIntent("what is the SPX flip", NO_LEDGER)?.intent, "concept_read");
    // "what is NVDA's max pain" → live Vector read, not a definition.
    assert.equal(classifyBieIntent("what is NVDA max pain", NO_LEDGER)?.intent, "vector_read");
    // "what is the market doing" → market context, not a definition.
    assert.notEqual(classifyBieIntent("what is the market doing", NO_LEDGER)?.intent, "concept_read");
  });

  test("'what is the vector setup on NVDA' → vector_read (live), not concept", () => {
    assert.equal(classifyBieIntent("what is the vector setup on NVDA", NO_LEDGER)?.intent, "vector_read");
  });

  test("staging fallback routes definitional questions to concept_read", () => {
    assert.equal(classifyBieStagingFallback("what is a gamma flip").intent, "concept_read");
    assert.equal(classifyBieStagingFallback("explain VEX").intent, "concept_read");
    // Boundary holds in the fallback too.
    assert.notEqual(classifyBieStagingFallback("what is the SPX flip").intent, "concept_read");
  });

  test("bieFollowups has a concept_read branch", () => {
    assert.equal(bieFollowups("concept_read").length, 3);
  });
});
