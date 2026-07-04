import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeLargoQuestion } from "./question-intent";

// LARGO-110: get_spx_play's tool description used to be a single terse line
// ("SPX play engine state.") while get_market_regime's was rich and used
// "regime"/"environment" language that overlaps in surface meaning with an
// engine-state question. On top of the description fix, the hint layer needs
// to steer Claude toward the right tool for two distinctly-worded questions
// that both plausibly smell like "SPX Slayer" territory.

test("engine-state question hints get_spx_play, not get_market_regime", () => {
  for (const question of [
    "what phase is SPX Slayer in right now",
    "why did the play get rejected",
  ]) {
    const intent = analyzeLargoQuestion(question, []);
    assert.equal(intent.needsSpxEngineState, true, `expected needsSpxEngineState for: "${question}"`);
    assert.equal(intent.needsMarketRegime, false, `expected !needsMarketRegime for: "${question}"`);
    assert.match(intent.guidance, /get_spx_play/, `expected get_spx_play hint in guidance for: "${question}"`);
    assert.doesNotMatch(
      intent.guidance,
      /get_market_regime/,
      `expected no get_market_regime hint in guidance for: "${question}"`
    );
  }
});

test("market-wide-regime question hints get_market_regime, not get_spx_play", () => {
  for (const question of ["what's the market regime today", "is this a good environment for calls"]) {
    const intent = analyzeLargoQuestion(question, []);
    assert.equal(intent.needsMarketRegime, true, `expected needsMarketRegime for: "${question}"`);
    assert.equal(intent.needsSpxEngineState, false, `expected !needsSpxEngineState for: "${question}"`);
    assert.match(intent.guidance, /get_market_regime/, `expected get_market_regime hint in guidance for: "${question}"`);
    assert.doesNotMatch(
      intent.guidance,
      /get_spx_play/,
      `expected no get_spx_play hint in guidance for: "${question}"`
    );
  }
});

test("bare engine-state phrasing does not also trip the existing PLAY_STATE_RE hint", () => {
  // Documents the gap this task closes: neither example question carries an explicit
  // action/state word (buy/sell/hold/trim/play/setup/signal) alongside an SPX-like
  // token, so the pre-existing needsPlayState hint alone would have missed both.
  const a = analyzeLargoQuestion("what phase is SPX Slayer in right now", []);
  const b = analyzeLargoQuestion("why did the play get rejected", []);
  assert.equal(a.needsPlayState, false);
  assert.equal(b.needsPlayState, false);
});
