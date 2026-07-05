import assert from "node:assert/strict";
import test from "node:test";
import { pickAffordableChainContract } from "./play-backfill";
import { buildDirectionalStockLevels } from "./play-levels";
import { validatePlayGeometry } from "./play-constraints";
import type { PlaybookPlay } from "./types";
import type { ChainStrikeRow, EditionChainData } from "./option-chain-prompt";

const rows: ChainStrikeRow[] = [
  {
    expiry: "2026-07-17",
    strike: 200,
    call_bid: 4.5,
    call_ask: 5.0,
    call_delta: 0.55,
    call_oi: 5000,
    call_iv: 0.4,
    put_bid: 3,
    put_ask: 3.5,
    put_delta: -0.45,
    put_oi: 4000,
    put_iv: 0.4,
  },
  {
    expiry: "2026-07-17",
    strike: 210,
    call_bid: 2.5,
    call_ask: 3.0,
    call_delta: 0.4,
    call_oi: 800,
    call_iv: 0.38,
    put_bid: 5,
    put_ask: 5.5,
    put_delta: -0.6,
    put_oi: 1200,
    put_iv: 0.42,
  },
];

const chain: EditionChainData = { spot: 205, rows };

test("pickAffordableChainContract: long picks nearest liquid affordable call", () => {
  const picked = pickAffordableChainContract("NET", "long", chain);
  assert.ok(picked);
  assert.equal(picked!.entry_premium, 5);
  assert.match(picked!.options_play, /NET \$200 Call 2026-07-17/);
});

test("pickAffordableChainContract: short picks put side", () => {
  const picked = pickAffordableChainContract("NET", "short", chain);
  assert.ok(picked);
  assert.match(picked!.options_play, /Put/);
});

test("pickAffordableChainContract: returns null when no affordable liquid contracts", () => {
  const expensive: EditionChainData = {
    spot: 205,
    rows: rows.map((r) => ({ ...r, call_ask: 25, put_ask: 25 })),
  };
  assert.equal(pickAffordableChainContract("NET", "long", expensive), null);
});

test("buildDirectionalStockLevels: LONG backfill shape passes geometry gate", () => {
  const levels = buildDirectionalStockLevels({ direction: "long", support: 60.72, resistance: 71.01 });
  const play: PlaybookPlay = {
    rank: 2,
    ticker: "MAGS",
    direction: "LONG",
    conviction: "B",
    play_type: "stock",
    thesis: "",
    key_signal: "",
    options_play: "-",
    risk_note: "",
    score: 80,
    ...levels,
  };
  assert.equal(validatePlayGeometry(play).ok, true);
  assert.notEqual(levels.stop, "60.72");
});

test("buildDirectionalStockLevels: prior Near-$X + stop=X shape FAILS geometry (regression guard)", () => {
  const play: PlaybookPlay = {
    rank: 2,
    ticker: "MAGS",
    direction: "LONG",
    conviction: "B",
    play_type: "stock",
    thesis: "",
    key_signal: "",
    entry_range: "Near $60.72",
    target: "71.01",
    stop: "60.72",
    options_play: "-",
    risk_note: "",
    score: 80,
  };
  assert.equal(validatePlayGeometry(play).ok, false);
});
