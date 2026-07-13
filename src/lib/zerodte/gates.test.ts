import { test } from "node:test";
import assert from "node:assert/strict";

// gates.ts is a pure leaf (type-only imports from ./board, ./intraday) — no
// mock.module scaffolding needed, unlike scan.test.ts's provider graph.
import {
  evaluateZeroDteGates,
  gateRejectionFor,
  MARKET_BIAS_MAX_AGE_MS,
  type ZeroDteGateInput,
} from "./gates";

const NOW_MS = Date.parse("2026-07-13T15:00:00Z"); // 11:00 ET on the fixture date

/** A mid-session, fully-aligned, fresh-bias input that clears every gate — each
 *  test flips exactly the dimension it exercises. */
function input(overrides: Partial<ZeroDteGateInput> = {}): ZeroDteGateInput {
  return {
    ticker: "QQQ",
    direction: "short",
    score: 70,
    nowEtMinutes: 11 * 60, // 11:00 ET
    nowMs: NOW_MS,
    bias: "down",
    biasAsOfMs: NOW_MS - 60_000, // 1-minute-old SPY bar — fresh
    ...overrides,
  };
}

// ── G-1 · tape alignment ───────────────────────────────────────────────────────────

test("G-1: aligned with the tape (short on a down day) commits", () => {
  const v = evaluateZeroDteGates(input());
  assert.equal(v.verdict, "COMMIT");
  assert.deepEqual(v.blocks, []);
});

test("G-1: long against a down tape is BLOCKED (was only a -6 score dent)", () => {
  const v = evaluateZeroDteGates(input({ direction: "long", score: 93 }));
  assert.equal(v.verdict, "BLOCKED", "a 93-score counter-tape long must still block (7/13 SPY long)");
  assert.equal(v.blocks[0]!.code, "tape_alignment");
  assert.match(v.blocks[0]!.reason, /fights the DOWN market tape/);
});

test("G-1: short against an up tape is BLOCKED (mirror)", () => {
  const v = evaluateZeroDteGates(input({ bias: "up", direction: "short" }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "tape_alignment");
});

test("G-1: a flat tape has no directional conflict — commits either way", () => {
  assert.equal(evaluateZeroDteGates(input({ bias: "flat", direction: "long" })).verdict, "COMMIT");
  assert.equal(evaluateZeroDteGates(input({ bias: "flat", direction: "short" })).verdict, "COMMIT");
});

test("G-1 fail-closed: missing bias blocks a NEW commit, with its own distinct code", () => {
  const v = evaluateZeroDteGates(input({ bias: null }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "no_market_bias");
  assert.match(v.blocks[0]!.reason, /fail closed/);
});

test("G-1 fail-closed: a stale bias (SPY bars stopped arriving) blocks like a missing one", () => {
  const staleMs = NOW_MS - MARKET_BIAS_MAX_AGE_MS - 1;
  const v = evaluateZeroDteGates(input({ biasAsOfMs: staleMs }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "no_market_bias");

  // Exactly at the age limit is still fresh — the boundary is exclusive.
  const edge = evaluateZeroDteGates(input({ biasAsOfMs: NOW_MS - MARKET_BIAS_MAX_AGE_MS }));
  assert.equal(edge.verdict, "COMMIT");
});

test("G-1 fail-closed: bias present but its freshness unknown (no bar timestamp) blocks", () => {
  const v = evaluateZeroDteGates(input({ biasAsOfMs: null }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "no_market_bias");
});

// ── G-2 · opening window ───────────────────────────────────────────────────────────

test("G-2: an aligned setup before 10:30 ET is BLOCKED, with the unlock time on the card", () => {
  // QQQ short flagged 10:20 on 7/13 — aligned, but inside the opening window.
  const v = evaluateZeroDteGates(input({ nowEtMinutes: 10 * 60 + 20 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.length, 1, "only the window blocks — alignment is clean");
  assert.equal(v.blocks[0]!.code, "opening_window");
  assert.equal(v.blocks[0]!.unlock_et, "10:30 ET");
});

test("G-2: exactly 10:30 ET unlocks (boundary inclusive)", () => {
  const v = evaluateZeroDteGates(input({ nowEtMinutes: 10 * 60 + 30 }));
  assert.equal(v.verdict, "COMMIT");
});

test("G-1 + G-2: a counter-tape long at 09:55 collects BOTH blocks (all reasons visible)", () => {
  // The 7/13 SPY long: flagged 09:55 on a down tape.
  const v = evaluateZeroDteGates(input({ direction: "long", nowEtMinutes: 9 * 60 + 55 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(
    v.blocks.map((b) => b.code),
    ["tape_alignment", "opening_window"]
  );
});

// ── rejection-row bridge ───────────────────────────────────────────────────────────

const rejectionSource = {
  ticker: "SPY",
  direction: "long" as const,
  gross_premium: 2_400_000,
  aggression: 0.62,
  side_dominance: 0.81,
  otm_pct: 0.4,
  prints: 12,
  first_seen: "2026-07-13T13:55:00Z",
  last_seen: "2026-07-13T13:58:00Z",
};

test("gateRejectionFor: one row per blocked setup — primary code, ALL reasons concatenated", () => {
  // 09:55 counter-tape long → two blocks (G-1 + G-2), one durable row.
  const v = evaluateZeroDteGates(
    input({ ticker: "SPY", direction: "long", bias: "down", nowEtMinutes: 9 * 60 + 55 })
  );
  const row = gateRejectionFor(rejectionSource, v);
  assert.equal(row.ticker, "SPY");
  assert.equal(row.gate_failed, "tape_alignment", "primary = first-evaluated failing gate");
  assert.match(String(row.reason), /fights the DOWN market tape/);
  assert.match(String(row.reason), /10:30 ET/, "second block's sentence rides the same row");
  // Evidence-gate columns carry through so both gate families are comparable rows.
  assert.equal(row.gross_premium, 2_400_000);
  assert.equal(row.direction, "long");
  assert.equal(row.prints, 12);
});

test("gateRejectionFor: a null verdict (gate context unreadable) is itself a fail-closed row", () => {
  const row = gateRejectionFor(rejectionSource, null);
  assert.equal(row.gate_failed, "gate_context_unavailable");
  assert.match(String(row.reason), /fail closed/);
});
