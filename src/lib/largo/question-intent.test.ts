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

// Task #127: SPX Slayer (`/dashboard`, single-instrument SPX/SPXW 0DTE play engine)
// and "0DTE Command" (branded "BlackOut Grid" in-app, `/grid`'s default tab, a
// completely separate multi-ticker 0DTE scanner — src/lib/zerodte/scan.ts) are BOTH
// branded with the bare word "0DTE." Before this fix, SPX_DESK_RE/SPX_DESK_TOOLS_RE/
// PLAY_STATE_RE/SPX_ENGINE_STATE_RE all hinted SPX Slayer's tools on that bare token
// alone, with zero signal distinguishing a genuinely-SPX-Slayer question from a
// genuinely-0DTE-Command question — Largo could easily answer a Grid-scoped question
// using SPX Slayer's data (or vice versa) and the member would never know which
// engine's numbers they were actually being given. ZERODTE_COMMAND_RE adds a
// stronger, more specific hint for wording that actually names the scanner, without
// touching the pre-existing (still intentionally ambiguous on a bare "0dte") hints.

test("scanner-scoped 0DTE Command question hints get_zerodte_plays via needsZeroDteCommand", () => {
  for (const question of [
    "what's the grid scanner finding right now",
    "any 0DTE command hunts today",
  ]) {
    const intent = analyzeLargoQuestion(question, []);
    assert.equal(intent.needsZeroDteCommand, true, `expected needsZeroDteCommand for: "${question}"`);
    assert.match(intent.guidance, /get_zerodte_plays/, `expected get_zerodte_plays hint in guidance for: "${question}"`);
  }
});

test("SPX-Slayer-scoped 0DTE question still hints get_spx_play/get_spx_structure, not the scanner-specific hint", () => {
  const intent = analyzeLargoQuestion("what's SPX Slayer's 0DTE play right now", []);
  // Bare "0dte" next to "spx"/"slayer" still legitimately means SPX Slayer's OWN
  // engine (SPX Slayer is also a 0DTE product) — unchanged by this fix.
  assert.equal(intent.needsSpxDesk, true, "expected needsSpxDesk for an explicit SPX Slayer question");
  assert.equal(intent.needsPlayState, true, "expected needsPlayState for an explicit SPX Slayer question");
  assert.match(intent.guidance, /get_spx_play/, "expected get_spx_play hint in guidance");
  assert.match(intent.guidance, /get_spx_structure/, "expected get_spx_structure hint in guidance");
  // No scanner-naming wording ("grid," "scan," "hunt," "command," "find" + 0dte) is
  // present, so the NEW, more-specific hint correctly stays quiet here — it only
  // adds force, it never displaces the SPX Slayer hints above.
  assert.equal(intent.needsZeroDteCommand, false, "expected !needsZeroDteCommand for an explicit SPX Slayer question");
});

test("bare, genuinely ambiguous '0dte play' question keeps its pre-existing (unresolved) ambiguity", () => {
  // "what's the 0dte play" has no token that pins it to EITHER engine — no "spx"/
  // "slayer"/"sniper" and no "grid"/"scan"/"hunt"/"command" scanner wording either.
  // This task does not claim to resolve that zero-information case (both products
  // are legitimately "the 0dte play" from a member's point of view); "sensibly" here
  // means: the pre-existing SPX Slayer hints still fire (unchanged behavior — a bare
  // "0dte" is still a legitimate SPX Slayer signal since SPX Slayer is a 0DTE
  // product too), AND get_zerodte_plays remains reachable at all via
  // getToolsForIntent's own separate, pre-existing bare-"0dte" match in tool-defs.ts
  // (not exercised by analyzeLargoQuestion, so not asserted here) — but the NEW,
  // stronger needsZeroDteCommand hint correctly does NOT fire on this wording alone,
  // since nothing here actually names the scanner. The fix's job was to make the
  // SPECIFIC-wording cases above unambiguous, not to manufacture signal that isn't
  // in the question.
  const intent = analyzeLargoQuestion("what's the 0dte play", []);
  assert.equal(intent.needsSpxDesk, true, "expected needsSpxDesk for a bare 0dte mention (pre-existing behavior)");
  assert.equal(intent.needsPlayState, true, "expected needsPlayState for a bare '0dte play' mention (pre-existing behavior)");
  assert.equal(intent.needsZeroDteCommand, false, "expected !needsZeroDteCommand — no scanner-naming wording present");
});

test("bare 'hunt'/'scanner' wording with NO 0dte context does not falsely fire needsZeroDteCommand", () => {
  // Caught during merge review: the first cut of ZERODTE_COMMAND_RE's hunt/scan/find
  // alternation had no required co-occurrence with 0dte/zero-dte, so it bare-matched
  // "hunt"/"scanner" in totally unrelated questions — e.g. Night Hawk's own nightly
  // "hunt" for candidates, or a generic market scanner question. That reintroduced
  // the exact overlap problem this task exists to fix (an irrelevant tool nudged in
  // for a question about a different product entirely). Every scan/hunt/find variant
  // now REQUIRES 0dte/zero-dte in the same question.
  for (const question of [
    "what is Night Hawk hunting tonight",
    "did the market scanner pick up anything on NVDA",
    "how is my hunt going",
  ]) {
    const intent = analyzeLargoQuestion(question, []);
    assert.equal(
      intent.needsZeroDteCommand,
      false,
      `expected !needsZeroDteCommand for unrelated hunt/scan wording: "${question}"`
    );
  }
});

// Task #147: deriveZeroDteSetups' gate-rejection near-misses now have a durable log
// (zerodte_scan_rejections) and a dedicated Largo tool (get_zerodte_rejections) —
// "why didn't ticker X make the Grid board" is a genuinely different question from
// needsZeroDteCommand above (the committed-plays board) and from needsSpxEngineState
// (SPX Slayer's own rejected/scanning history), so it gets its own hint.

test("near-miss/rejection wording paired with a 0dte/grid token hints get_zerodte_rejections", () => {
  for (const question of [
    "why didn't AAPL make the 0dte board",
    "was NVDA a near miss on the grid scanner",
    "what gate did TSLA fail on the grid",
    "why wasn't SNDK flagged by the 0dte scan",
  ]) {
    const intent = analyzeLargoQuestion(question, []);
    assert.equal(intent.needsZeroDteRejections, true, `expected needsZeroDteRejections for: "${question}"`);
    assert.match(intent.guidance, /get_zerodte_rejections/, `expected get_zerodte_rejections hint for: "${question}"`);
  }
});

test("near-miss wording with NO 0dte/grid token stays unresolved, same documented gap as the bare-0dte case", () => {
  // "why didn't AAPL make the board" has no explicit 0dte/zero-dte/grid token — same
  // intentional, documented ambiguity ZERODTE_COMMAND_RE already leaves for a bare
  // "0dte play" mention (see the test above this block). This hint's job is to
  // resolve the SPECIFIC-wording case, not manufacture signal that isn't present.
  const intent = analyzeLargoQuestion("why didn't AAPL make the board today", []);
  assert.equal(intent.needsZeroDteRejections, false);
});

test("bare 'near miss'/'rejected' wording with NO 0dte/grid context does not falsely fire needsZeroDteRejections", () => {
  // Same false-positive discipline as ZERODTE_COMMAND_RE's own hunt/scan/find family
  // (task #127's merge-time fix) — "near miss" or "didn't make it" alone is common
  // phrasing for entirely unrelated questions and must require the explicit token.
  for (const question of [
    "that trade was a near miss on my stop loss",
    "was AAPL rejected from tonight's Night Hawk edition",
    "why didn't my order hit",
  ]) {
    const intent = analyzeLargoQuestion(question, []);
    assert.equal(
      intent.needsZeroDteRejections,
      false,
      `expected !needsZeroDteRejections for unrelated wording: "${question}"`
    );
  }
});

// Task #136: BlackOut Thermal's GEX regime/flip/wall-crossing HISTORY is now a
// durable log (gex_regime_events) with its own Largo tool (get_gex_regime_events) —
// "when did the flip last cross" / "how many times has the wall moved" is a
// genuinely different question from get_gex/get_positioning's CURRENT-snapshot-only
// view, so it gets its own hint, same pattern as needsZeroDteRejections above.

test("GEX regime-history wording (retrospective/count trigger + a GEX-domain token) hints get_gex_regime_events", () => {
  for (const question of [
    "when did SPY's gamma flip last cross",
    "how many times has NVDA's call wall broken today",
    "has the gamma regime flipped this session",
    "what's SPX's wall history today",
  ]) {
    const intent = analyzeLargoQuestion(question, []);
    assert.equal(intent.needsGexRegimeHistory, true, `expected needsGexRegimeHistory for: "${question}"`);
    assert.match(intent.guidance, /get_gex_regime_events/, `expected get_gex_regime_events hint for: "${question}"`);
  }
});

test("bare market-regime wording (no GEX-domain token) does not falsely fire needsGexRegimeHistory — stays disjoint from needsMarketRegime", () => {
  // "regime" alone is MARKET_REGIME_RE's own vocabulary (LARGO-110) — this hint must
  // require an explicit GEX-domain token (gamma flip/gex/wall/etc.), not fire on the
  // bare word "regime" the way MARKET_REGIME_RE deliberately does for its own tool.
  for (const question of ["what's the market regime today", "is this a good regime for calls"]) {
    const intent = analyzeLargoQuestion(question, []);
    assert.equal(
      intent.needsGexRegimeHistory,
      false,
      `expected !needsGexRegimeHistory for market-regime wording: "${question}"`
    );
  }
});

test("bare retrospective/count wording with NO GEX-domain token does not falsely fire needsGexRegimeHistory", () => {
  for (const question of [
    "how many times did I trade today",
    "when did the market open",
    "how many times has AAPL missed earnings",
  ]) {
    const intent = analyzeLargoQuestion(question, []);
    assert.equal(
      intent.needsGexRegimeHistory,
      false,
      `expected !needsGexRegimeHistory for unrelated wording: "${question}"`
    );
  }
});

// Task #131: detectFlowAnomalies' below-threshold/dedup-suppressed candidates now
// have a durable log (flow_anomaly_near_misses) and a dedicated Largo tool
// (get_flow_anomaly_near_misses) — "why didn't HELIX flag ticker X" is a genuinely
// different question from needsMarketRegime above (get_market_regime's committed-
// anomaly COUNT only) and from needsZeroDteRejections (0DTE Command's own separate
// scanner/threshold set), so it gets its own hint.

test("near-miss/anomaly wording paired with an anomaly/HELIX token hints get_flow_anomaly_near_misses", () => {
  for (const question of [
    "why didn't HELIX flag AAPL today",
    "was TSLA a near miss on the anomaly scan",
    "why wasn't SNDK flagged as a HELIX anomaly",
    "did NVDA trigger a HELIX anomaly or was it a near miss",
  ]) {
    const intent = analyzeLargoQuestion(question, []);
    assert.equal(intent.needsFlowAnomalyNearMisses, true, `expected needsFlowAnomalyNearMisses for: "${question}"`);
    assert.match(
      intent.guidance,
      /get_flow_anomaly_near_misses/,
      `expected get_flow_anomaly_near_misses hint for: "${question}"`
    );
  }
});

test("near-miss wording with NO anomaly/HELIX token stays unresolved, same documented gap as the 0dte-rejection case", () => {
  // "why didn't AAPL fire today" has no explicit anomaly/helix token — same
  // intentional, documented ambiguity ZERODTE_REJECTION_RE already leaves for a
  // bare "why didn't X make the board" mention. This hint's job is to resolve the
  // SPECIFIC-wording case, not manufacture signal that isn't present.
  const intent = analyzeLargoQuestion("why didn't AAPL fire today", []);
  assert.equal(intent.needsFlowAnomalyNearMisses, false);
});

test("bare 'near miss'/'below threshold' wording with NO anomaly/HELIX context does not falsely fire needsFlowAnomalyNearMisses", () => {
  // Same false-positive discipline as ZERODTE_REJECTION_RE's own co-occurrence
  // requirement — "near miss" or "wasn't flagged" alone is common phrasing for
  // entirely unrelated questions and must require the explicit anomaly/HELIX token.
  for (const question of [
    "that trade was a near miss on my stop loss",
    "was AAPL rejected from tonight's Night Hawk edition",
    "why wasn't AAPL flagged for the 0dte board",
  ]) {
    const intent = analyzeLargoQuestion(question, []);
    assert.equal(
      intent.needsFlowAnomalyNearMisses,
      false,
      `expected !needsFlowAnomalyNearMisses for unrelated wording: "${question}"`
    );
  }
});
