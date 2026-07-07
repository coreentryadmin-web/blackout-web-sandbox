import assert from "node:assert/strict";
import test from "node:test";
import { buildGroundedPlayExplanationFallback } from "./play-explainer-fallback";
import { checkNumbersGrounded, extractNumbersFromText } from "@/lib/grounding-guard";
import type { PlaybookPlay } from "./types";

const play: PlaybookPlay = {
  rank: 1,
  ticker: "NBIS",
  direction: "LONG",
  conviction: "A",
  play_type: "stock",
  thesis: "NBIS call setup",
  key_signal: "NBIS call setup",
  entry_range: "Breakout above $300",
  target: "$330",
  stop: "$285",
  options_play: "NBIS $300 Call 2026-09-18 entry prem ~$45.10",
  entry_premium: 45.1,
  entry_cost_per_contract: 4510,
  premium_cap_ok: false,
  score: 90,
};

test("grounded play explanation fallback is card-only and does not disclose providers", () => {
  const text = buildGroundedPlayExplanationFallback({ play });

  assert.match(text, /NBIS \$300 Call 2026-09-18/);
  assert.match(text, /\$45\.1\/share/);
  assert.doesNotMatch(text, /Claude|Anthropic|API_KEY|provider/i);
});

// generatePlayExplanation's grounding check runs extractNumbersFromText over the same
// play-card text the prompt is built from. buildGroundedPlayExplanationFallback (above) is a
// server-only-free stand-in with the same numeric content (entry/target/stop/premium), so
// these tests exercise the exact same mechanism without pulling in play-explainer.ts's
// transitive "server-only" import chain (via fetchTickerDossier) into the test runner.
test("grounding guard: a briefing citing only play-card numbers passes", () => {
  const known = extractNumbersFromText(buildGroundedPlayExplanationFallback({ play }));
  const briefing = "Entry above 300 targets 330 with a stop at 285; premium runs 45.1/share.";
  const result = checkNumbersGrounded(briefing, known);
  assert.equal(result.grounded, true);
});

test("grounding guard: a briefing citing a hallucinated level fails", () => {
  const known = extractNumbersFromText(buildGroundedPlayExplanationFallback({ play }));
  const briefing = "Watch for a breakout continuation toward 415, a level not on the card.";
  const result = checkNumbersGrounded(briefing, known);
  assert.equal(result.grounded, false);
  assert.equal(result.ungroundedValue, 415);
});
