import assert from "node:assert/strict";
import test from "node:test";
import { buildGroundedPlayExplanationFallback } from "./play-explainer-fallback";
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
