// largoAnswerCacheKey regression tests (PR-L1) — the live concept-coverage defect.
//
// Root cause of the "13 concept questions answered with the GEX definition" battery failure (and
// the "what is Thermal → dark-pool definition" report): the answer-cache key carried a question
// hash ONLY for spx_desk_read / spx_invalidation / ticker_advice, so every `concept_read` shared
// the single key `bie:largo:concept_read:na:na`. Within a TTL window the first concept answer
// cached (GEX in the battery — its first concept question) was served verbatim for every other
// definitional question, even though lookupGlossary resolved each term correctly. These tests pin
// the fix: every question-shaped intent keys on the question; question-independent intents
// deliberately do not (cache hit-rate — same numbers for every member within the TTL).

import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";

// Loaded in before() — the tsx test transform is CJS, so no top-level await.
let largoAnswerCacheKey: typeof import("./platform-cache").largoAnswerCacheKey;

describe("largoAnswerCacheKey", () => {
  before(async () => {
    mock.module("server-only", { namedExports: {} });
    ({ largoAnswerCacheKey } = await import("./platform-cache"));
  });
  test("REGRESSION (PR-L1): two different concept questions never share a cache key", () => {
    const gex = largoAnswerCacheKey("concept_read", null, null, "What is GEX?");
    const maxPain = largoAnswerCacheKey("concept_read", null, null, "What is max pain?");
    const thermal = largoAnswerCacheKey("concept_read", null, null, "what is Thermal");
    const darkPool = largoAnswerCacheKey("concept_read", null, null, "What is a dark pool level?");
    assert.notEqual(gex, maxPain, "max pain must not be served the cached GEX answer");
    assert.notEqual(thermal, darkPool, "Thermal must not be served the cached dark-pool answer");
    assert.notEqual(gex, thermal);
  });

  test("every question-shaped intent keys on the question", () => {
    for (const intent of [
      "concept_read",
      "universal_lookup",
      "verdict",
      "system_diagnostic",
      "cortex_read",
      "nighthawk_edition",
      "vector_read",
      "spx_desk_read",
      "spx_invalidation",
      "ticker_advice",
    ]) {
      const a = largoAnswerCacheKey(intent, "NVDA", null, "why did we skip NVDA?");
      const b = largoAnswerCacheKey(intent, "NVDA", null, "why did we commit NVDA?");
      assert.notEqual(a, b, `${intent}: two different questions must not collide`);
    }
  });

  test("stable: the same question yields the same key (the cache still works)", () => {
    const a = largoAnswerCacheKey("concept_read", null, null, "What is max pain?");
    const b = largoAnswerCacheKey("concept_read", null, null, "What is max pain?");
    assert.equal(a, b);
  });

  test("question-INDEPENDENT intents stay question-less on purpose (hit-rate preserved)", () => {
    // spx_structure/market_context compose the same answer for every phrasing — keying them on the
    // question would only fragment the cache without changing any answer.
    const a = largoAnswerCacheKey("spx_structure", "SPX", null, "spx structure?");
    const b = largoAnswerCacheKey("spx_structure", "SPX", null, "what are the SPX levels");
    assert.equal(a, b);
    assert.equal(
      largoAnswerCacheKey("market_context", null, null, "market context"),
      largoAnswerCacheKey("market_context", null, null, "how's the tape")
    );
  });

  test("ticker and ticker_b still partition the key space", () => {
    assert.notEqual(
      largoAnswerCacheKey("ticker_compare", "SPX", "NVDA"),
      largoAnswerCacheKey("ticker_compare", "SPY", "QQQ")
    );
    assert.notEqual(
      largoAnswerCacheKey("vector_read", "NVDA", null, "gamma flip?"),
      largoAnswerCacheKey("vector_read", "ASTS", null, "gamma flip?")
    );
  });
});
