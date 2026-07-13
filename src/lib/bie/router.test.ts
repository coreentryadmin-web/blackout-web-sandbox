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
