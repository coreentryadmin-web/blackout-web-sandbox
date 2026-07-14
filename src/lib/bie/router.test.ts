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

  test("TERSE bare glossary term (no 'what is') routes to concept_read", () => {
    // The compound terse-barrage shape: "GEX? VEX? max pain?" splits to bare terms.
    for (const q of ["GEX", "VEX", "max pain", "king node", "dark pool"]) {
      assert.equal(classifyBieIntent(q, NO_LEDGER)?.intent, "concept_read", `bare "${q}" → concept`);
    }
    // A bare TICKER is not a concept (it's a live read target), and an unknown short phrase isn't either.
    assert.notEqual(classifyBieIntent("SPY", NO_LEDGER)?.intent, "concept_read");
    assert.notEqual(classifyBieIntent("flongle", NO_LEDGER)?.intent, "concept_read");
  });

  test("BOUNDARY: a live-EDITION/temporal question is NOT stolen by concept_read", () => {
    // "what is tonight's Night Hawk edition" is a LIVE request — it must not return the Night Hawk
    // DEFINITION. It falls through (→ Claude → get_nighthawk_edition), not concept_read.
    assert.notEqual(classifyBieIntent("what is tonight's Night Hawk edition", NO_LEDGER)?.intent, "concept_read");
    assert.notEqual(classifyBieIntent("what's the latest Night Hawk edition", NO_LEDGER)?.intent, "concept_read");
    assert.notEqual(classifyBieIntent("what is today's edition", NO_LEDGER)?.intent, "concept_read");
    // The plain PRODUCT definition still resolves to concept_read.
    assert.equal(classifyBieIntent("what is Night Hawk", NO_LEDGER)?.intent, "concept_read");
    assert.equal(classifyBieIntent("what does Night Hawk do", NO_LEDGER)?.intent, "concept_read");
  });
});

describe("router: universal_lookup intent", () => {
  test("verb + explicit internal path routes to universal_lookup", () => {
    assert.equal(classifyBieIntent("pull /api/market/gex-positioning?ticker=SPY", NO_LEDGER)?.intent, "universal_lookup");
    assert.equal(classifyBieIntent("show me /api/platform/intel", NO_LEDGER)?.intent, "universal_lookup");
  });

  test("verb + named provider routes to universal_lookup", () => {
    assert.equal(classifyBieIntent("get /v3/reference/tickers from Polygon", NO_LEDGER)?.intent, "universal_lookup");
    assert.equal(classifyBieIntent("pull the darkpool data from unusual whales", NO_LEDGER)?.intent, "universal_lookup");
  });

  test("BOUNDARY: a verb WITHOUT a path/provider is NOT universal_lookup", () => {
    // "show me the SPX setup" has no path/source → stays a normal desk read, not universal.
    assert.notEqual(classifyBieIntent("show me the SPX setup", NO_LEDGER)?.intent, "universal_lookup");
    // A plain concept question isn't universal either.
    assert.equal(classifyBieIntent("what is GEX", NO_LEDGER)?.intent, "concept_read");
    // A plain Vector question stays vector_read.
    assert.equal(classifyBieIntent("show me the vector walls for NVDA", NO_LEDGER)?.intent, "vector_read");
  });

  test("staging fallback also routes explicit-endpoint questions to universal_lookup", () => {
    assert.equal(classifyBieStagingFallback("pull /api/market/spx/desk").intent, "universal_lookup");
  });

  test("bieFollowups has a universal_lookup branch", () => {
    assert.equal(bieFollowups("universal_lookup").length, 3);
  });
});

describe("router: universal_lookup intent", () => {
  test("verb + explicit internal path routes to universal_lookup", () => {
    assert.equal(classifyBieIntent("pull /api/market/gex-positioning?ticker=SPY", NO_LEDGER)?.intent, "universal_lookup");
    assert.equal(classifyBieIntent("show me /api/platform/intel", NO_LEDGER)?.intent, "universal_lookup");
  });

  test("verb + named provider routes to universal_lookup", () => {
    assert.equal(classifyBieIntent("get /v3/reference/tickers from Polygon", NO_LEDGER)?.intent, "universal_lookup");
    assert.equal(classifyBieIntent("pull the darkpool data from unusual whales", NO_LEDGER)?.intent, "universal_lookup");
  });

  test("BOUNDARY: a verb WITHOUT a path/provider is NOT universal_lookup", () => {
    // "show me the SPX setup" has no path/source → stays a normal desk read, not universal.
    assert.notEqual(classifyBieIntent("show me the SPX setup", NO_LEDGER)?.intent, "universal_lookup");
    // A plain concept question isn't universal either.
    assert.equal(classifyBieIntent("what is GEX", NO_LEDGER)?.intent, "concept_read");
    // A plain Vector question stays vector_read.
    assert.equal(classifyBieIntent("show me the vector walls for NVDA", NO_LEDGER)?.intent, "vector_read");
  });

  test("staging fallback also routes explicit-endpoint questions to universal_lookup", () => {
    assert.equal(classifyBieStagingFallback("pull /api/market/spx/desk").intent, "universal_lookup");
  });

  test("bieFollowups has a universal_lookup branch", () => {
    assert.equal(bieFollowups("universal_lookup").length, 3);
  });
});

describe("router: system_diagnostic intent", () => {
  test("'why isn't X forming' routes to system_diagnostic — BEFORE REASONING_RE (not Claude)", () => {
    assert.equal(classifyBieIntent("why isn't NVDA GEX forming", NO_LEDGER)?.intent, "system_diagnostic");
    assert.equal(classifyBieIntent("why aren't MSFT beads forming on the map", NO_LEDGER)?.intent, "system_diagnostic");
    assert.equal(classifyBieIntent("why isn't SPX gex updating", NO_LEDGER)?.intent, "system_diagnostic");
  });

  test("pipeline-health questions route to system_diagnostic", () => {
    assert.equal(classifyBieIntent("is the flow pipeline healthy", NO_LEDGER)?.intent, "system_diagnostic");
    assert.equal(classifyBieIntent("what's failing right now", NO_LEDGER)?.intent, "system_diagnostic");
  });

  test("the diagnostic carries the ticker when named", () => {
    assert.equal(classifyBieIntent("why isn't NVDA GEX forming", NO_LEDGER)?.ticker, "NVDA");
  });

  test("a normal Vector question is NOT stolen by the diagnostic", () => {
    assert.equal(classifyBieIntent("which walls are building on ASTS", NO_LEDGER)?.intent, "vector_read");
  });

  test("bieFollowups has a system_diagnostic branch", () => {
    assert.equal(bieFollowups("system_diagnostic").length, 3);
  });
});

describe("router: verdict intent (cross-tool synthesis, task #59)", () => {
  test("the flagship grading question routes to verdict with its ticker", () => {
    const r = classifyBieIntent("is SPX 7500 0DTE good today", NO_LEDGER);
    assert.equal(r?.intent, "verdict");
    assert.equal(r?.ticker, "SPX");
  });

  test("imperative hold-into-earnings routes to verdict for the named ticker", () => {
    const r = classifyBieIntent("hold NVDA into earnings", NO_LEDGER);
    assert.equal(r?.intent, "verdict");
    assert.equal(r?.ticker, "NVDA");
  });

  test("explicit verdict language routes to verdict", () => {
    assert.equal(classifyBieIntent("what's the verdict on SPX", NO_LEDGER)?.intent, "verdict");
    assert.equal(classifyBieIntent("give me the call on NVDA", NO_LEDGER)?.intent, "verdict");
  });

  test("market risk-on/off is a market-wide verdict", () => {
    assert.equal(classifyBieIntent("is the market risk-on today", NO_LEDGER)?.intent, "verdict");
    assert.equal(classifyBieIntent("is the market risk-off right now", NO_LEDGER)?.intent, "verdict");
  });

  test("BOUNDARY: a 'should I ...' question stays ticker_advice, NOT verdict (tested advice shapes preserved)", () => {
    const LEDGER = new Set<string>(["NVDA", "TSLA"]);
    assert.equal(classifyBieIntent("Should I buy NVDA calls into earnings?", LEDGER)?.intent, "ticker_advice");
    assert.equal(classifyBieIntent("Should I hold my TSLA play into the close?", LEDGER)?.intent, "ticker_advice");
  });

  test("BOUNDARY: 'compare X vs Y' stays ticker_compare, not verdict", () => {
    assert.equal(classifyBieIntent("compare NVDA vs AMD", NO_LEDGER)?.intent, "ticker_compare");
  });

  test("staging fallback also routes verdict questions to verdict", () => {
    assert.equal(classifyBieStagingFallback("is SPX 7500 0DTE good today").intent, "verdict");
    assert.equal(classifyBieStagingFallback("hold NVDA into earnings").intent, "verdict");
    assert.equal(classifyBieStagingFallback("is the market risk-on today").intent, "verdict");
  });

  test("bieFollowups has a verdict branch", () => {
    assert.equal(bieFollowups("verdict").length, 3);
  });
});

describe("router: SPX weekly/monthly horizon-scope (never present a 0DTE number as the monthly)", () => {
  test("a weekly SPX structure figure routes to the horizon-scoped Vector engine, NOT the 0DTE desk", () => {
    for (const q of ["SPX weekly flip", "where's the SPX weekly gamma flip", "SPX weekly walls", "SPX weekly max pain"]) {
      const r = classifyBieIntent(q, NO_LEDGER);
      assert.equal(r?.intent, "vector_read", `weekly → vector: ${q}`);
      assert.equal(r?.ticker, "SPX");
      assert.equal(r?.horizon, "weekly");
    }
  });

  test("a monthly SPX structure figure routes to Vector with the monthly horizon", () => {
    const r = classifyBieIntent("SPX monthly flip and walls", NO_LEDGER);
    assert.equal(r?.intent, "vector_read");
    assert.equal(r?.ticker, "SPX");
    assert.equal(r?.horizon, "monthly");
  });

  test("a bare (no-horizon) SPX structure ask still uses the SPX desk — unchanged", () => {
    assert.equal(classifyBieIntent("where's the SPX gamma flip", NO_LEDGER)?.intent, "spx_structure");
    assert.equal(classifyBieIntent("SPX walls and max pain", NO_LEDGER)?.intent, "spx_structure");
  });

  test("a weekly SPX question WITHOUT a structure figure is NOT re-routed (stays a desk read)", () => {
    // "SPX weekly setup" has no flip/wall/maxpain figure to leak → the desk read is fine.
    assert.notEqual(classifyBieIntent("what's the SPX weekly setup", NO_LEDGER)?.intent, "vector_read");
  });

  test("staging fallback also horizon-scopes weekly/monthly SPX structure to Vector", () => {
    assert.equal(classifyBieStagingFallback("SPX weekly flip").intent, "vector_read");
    assert.equal(classifyBieStagingFallback("SPX weekly flip").horizon, "weekly");
    assert.equal(classifyBieStagingFallback("SPX monthly max pain").horizon, "monthly");
    // A bare SPX structure ask still falls to the SPX desk read in staging.
    assert.equal(classifyBieStagingFallback("SPX gamma flip").intent, "spx_desk_read");
  });
});
