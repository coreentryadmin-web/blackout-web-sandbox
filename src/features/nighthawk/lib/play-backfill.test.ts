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
    rows: rows.map((r) => ({ ...r, call_ask: 40, put_ask: 40 })),
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

// ── Spot-anchored entry levels (PR-N14) ─────────────────────────────────────

test("buildDirectionalStockLevels: LONG with spot anchors entry near spot, not support", () => {
  const levels = buildDirectionalStockLevels({
    direction: "long",
    support: 174,
    resistance: 230,
    spot: 212,
  });
  // Entry should be near spot (±0.5%), NOT near support ($174)
  const play: PlaybookPlay = {
    rank: 1, ticker: "COF", direction: "LONG", conviction: "A",
    play_type: "stock", thesis: "", key_signal: "",
    options_play: "-", risk_note: "", score: 72,
    ...levels,
  };
  assert.equal(validatePlayGeometry(play).ok, true);
  // Entry band should contain values near 212
  assert.match(levels.entry_range, /\$21[0-3]/);
  // Stop should be at support level, not a synthetic value
  assert.equal(levels.stop, "174.00");
  // Target at resistance
  assert.equal(levels.target, "230.00");
});

test("buildDirectionalStockLevels: SHORT with spot anchors entry near spot, not resistance", () => {
  const levels = buildDirectionalStockLevels({
    direction: "short",
    support: 280,
    resistance: 360,
    spot: 354,
  });
  const play: PlaybookPlay = {
    rank: 1, ticker: "GOOGL", direction: "SHORT", conviction: "B",
    play_type: "stock", thesis: "", key_signal: "",
    options_play: "-", risk_note: "", score: 67,
    ...levels,
  };
  assert.equal(validatePlayGeometry(play).ok, true);
  // Entry band near spot ($354)
  assert.match(levels.entry_range, /\$35[2-6]/);
  // Target at support
  assert.equal(levels.target, "280.00");
  // Stop at resistance
  assert.equal(levels.stop, "360.00");
});

test("buildDirectionalStockLevels: spot-anchored entry within 3.5% of spot (publish gate compatible)", () => {
  const levels = buildDirectionalStockLevels({
    direction: "long",
    support: 174,
    resistance: 230,
    spot: 212,
  });
  // Parse entry band edges
  const nums = levels.entry_range.match(/[\d.]+/g)!.map(Number);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  // Both edges within 0.5% of spot
  assert.ok(Math.abs(lo - 212) / 212 < 0.006, `lo ${lo} too far from spot 212`);
  assert.ok(Math.abs(hi - 212) / 212 < 0.006, `hi ${hi} too far from spot 212`);
});

test("buildDirectionalStockLevels: legacy path still works without spot (backfill compatibility)", () => {
  const levels = buildDirectionalStockLevels({
    direction: "long",
    support: 60.72,
    resistance: 71.01,
  });
  // Legacy: entry near support
  assert.match(levels.entry_range, /\$60/);
  // Regression: stop not equal to support
  assert.notEqual(levels.stop, "60.72");
});
