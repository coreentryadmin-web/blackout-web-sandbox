import assert from "node:assert/strict";
import test from "node:test";
import { groundPlay, groundPlays } from "./grounding";
import { parseOptionsContract, type ChainStrikeRow } from "./option-chain-prompt";
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

test("groundPlay flags (not drops) a parsed option contract absent from exact/prefetched chain data", () => {
  const result = groundPlay(play(8.5), { spot: 296, rows: [frontExpiryRow] }, dossier);

  assert.equal(result.severity, "flag");
  assert.equal(result.play.entry_premium, undefined);
  assert.match(result.play.options_play, /not confirmed on chain/i);
  assert.match(result.issues.map((i) => i.detail).join(" "), /premium stripped/);
});

test("groundPlay drops a confirmed contract when live premium exceeds cap", () => {
  const result = groundPlay(
    play(8.5),
    { spot: 296, rows: [frontExpiryRow, nbisSep300Call] },
    dossier
  );

  assert.equal(result.severity, "drop");
  assert.match(result.issues.map((i) => i.detail).join(" "), /\$44\.95 exceeds the \$20\/share cap/);
});

// ── groundPlays' `dropped` field (task #141) ──────────────────────────────────────
// groundPlays() is the batch wrapper generateEditionPlays() calls; before this task a HARD
// drop only ever reached a console.warn + a flattened `summary.notes` string — the caller had
// no structured way to build a durable rejection-audit row. `dropped` returns the SAME
// drop-severity issues that produced the note above, just structured (ticker/play/issues).

test("groundPlays: a HARD-dropped play is removed from `plays` AND reported (structured) in `dropped`", () => {
  const chains = { NBIS: { spot: 296, rows: [frontExpiryRow, nbisSep300Call] } };
  const dossiers = { NBIS: dossier };

  const { plays: kept, summary, dropped } = groundPlays([play(8.5)], chains, dossiers);

  assert.equal(kept.length, 0, "the dropped play must not survive into the kept list");
  assert.equal(summary.dropped_ungrounded, 1);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0]!.ticker, "NBIS");
  assert.equal(dropped[0]!.play.ticker, "NBIS");
  assert.ok(dropped[0]!.issues.length >= 1);
  assert.ok(dropped[0]!.issues.every((i) => i.severity === "drop"));
  assert.match(dropped[0]!.issues.map((i) => i.detail).join(" "), /\$44\.95 exceeds the \$20\/share cap/);
});

test("groundPlays: an ungrounded/flagged/ok mix only reports the HARD-dropped play in `dropped`", () => {
  const affordableRow: ChainStrikeRow = {
    ...nbisSep300Call,
    call_bid: 6.1,
    call_ask: 6.55,
    call_oi: 10_647,
  };
  const chains = { NBIS: { spot: 296, rows: [frontExpiryRow, affordableRow] } };
  const dossiers = { NBIS: dossier };

  // play(6.32) already matches the live mark exactly → "ok", not dropped or flagged.
  const { plays: kept, dropped } = groundPlays([play(6.32)], chains, dossiers);

  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 0);
});

test("groundPlay rewrites a confirmed affordable contract to the live mark", () => {
  const affordableRow: ChainStrikeRow = {
    ...nbisSep300Call,
    call_bid: 6.1,
    call_ask: 6.55,
    call_oi: 10_647,
  };
  const result = groundPlay(
    play(8.5),
    { spot: 296, rows: [frontExpiryRow, affordableRow] },
    dossier
  );

  assert.equal(result.severity, "flag");
  assert.equal(result.play.entry_premium, 6.32);
  assert.equal(result.play.entry_cost_per_contract, 632);
  assert.match(result.play.options_play, /entry prem ~\$6\.32/);
});

test("groundPlay accepts a confirmed contract when generated premium already matches live mark", () => {
  const affordableRow: ChainStrikeRow = {
    ...nbisSep300Call,
    call_bid: 6.1,
    call_ask: 6.55,
    call_oi: 10_647,
  };
  const result = groundPlay(play(6.32), { spot: 296, rows: [frontExpiryRow, affordableRow] }, dossier);

  assert.equal(result.severity, "ok");
  assert.equal(result.play.entry_premium, 6.32);
  assert.equal(result.issues.length, 0);
});

test("parseOptionsContract handles CALL $strike wording from generated plays", () => {
  assert.deepEqual(parseOptionsContract("ANET CALL $175 2026-07-17, 2 contracts, entry prem ~$3.50"), {
    strike: 175,
    side: "call",
    expiryYmd: "2026-07-17",
  });
  assert.deepEqual(parseOptionsContract("ORCL PUT $150 2026-08-21, 2 contracts, entry prem ~$4.20"), {
    strike: 150,
    side: "put",
    expiryYmd: "2026-08-21",
  });
});

test("groundPlay drops contradictory user-visible prose strike claims", () => {
  const affordableRow: ChainStrikeRow = {
    ...nbisSep300Call,
    call_bid: 6.1,
    call_ask: 6.55,
    call_oi: 10_647,
  };
  const contradictory = {
    ...play(6.32),
    thesis: "Calls at 410 are the trigger",
    key_signal: "Strike stack supports calls at 410",
  };

  const result = groundPlay(contradictory, { spot: 296, rows: [frontExpiryRow, affordableRow] }, dossier);

  assert.equal(result.severity, "drop");
  assert.match(result.issues.map((i) => i.detail).join(" "), /contradictory setup text/);
});
