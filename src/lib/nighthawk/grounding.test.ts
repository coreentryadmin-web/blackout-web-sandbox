import assert from "node:assert/strict";
import test from "node:test";
import { groundPlay } from "./grounding";
import type { ChainStrikeRow } from "./option-chain-prompt";
import type { PlaybookPlay } from "./types";

function play(entryPremium: number): PlaybookPlay {
  return {
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
    options_play: `NBIS $300 Call 2026-09-18 entry prem ~$${entryPremium.toFixed(2)}`,
    entry_premium: entryPremium,
    entry_cost_per_contract: Math.round(entryPremium * 100),
    premium_cap_ok: entryPremium <= 20,
    score: 90,
  };
}

const frontExpiryRow: ChainStrikeRow = {
  expiry: "2026-07-17",
  strike: 295,
  call_bid: 10,
  call_ask: 11,
  call_delta: 0.5,
  call_oi: 2000,
  call_iv: 1.1,
  put_bid: 8,
  put_ask: 9,
  put_delta: -0.5,
  put_oi: 2000,
  put_iv: 1.1,
};

const nbisSep300Call: ChainStrikeRow = {
  expiry: "2026-09-18",
  strike: 300,
  call_bid: 44,
  call_ask: 45.9,
  call_delta: 0.63,
  call_oi: 2000,
  call_iv: 1.1889,
  put_bid: 5,
  put_ask: 6,
  put_delta: -0.25,
  put_oi: 1000,
  put_iv: 1.1,
};

const dossier = {
  ticker: "NBIS",
  tech: { price: 296, support_levels: [285], resistance_levels: [300, 330] },
  flows: [],
  iv_rank: 118.89,
} as any;

test("groundPlay drops a parsed option contract absent from exact/prefetched chain data", () => {
  const result = groundPlay(play(8.5), { spot: 296, rows: [frontExpiryRow] }, dossier);

  assert.equal(result.severity, "drop");
  assert.match(result.issues.map((i) => i.detail).join(" "), /premium cannot be grounded/);
});

test("groundPlay drops a confirmed contract when entry premium is outside live bid/ask tolerance", () => {
  const result = groundPlay(
    play(8.5),
    { spot: 296, rows: [frontExpiryRow, nbisSep300Call] },
    dossier
  );

  assert.equal(result.severity, "drop");
  assert.match(result.issues.map((i) => i.detail).join(" "), /\$8\.50.*\$44\.95/);
});

test("groundPlay accepts a confirmed contract when entry premium reconciles to live bid/ask", () => {
  const result = groundPlay(
    play(45.1),
    { spot: 296, rows: [frontExpiryRow, nbisSep300Call] },
    dossier
  );

  assert.equal(result.severity, "ok");
  assert.equal(result.issues.length, 0);
});
