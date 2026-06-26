import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichPosition, type ContractValuation } from "./valuation";
import type { UserPositionRow } from "@/lib/db";

// Locks the Night's Watch MONEY MATH (pure enrichPosition) so the side-aware
// 4-quadrant accounting (long/short × call/put) can never silently regress.
//
// Identities under test (strike 100, contracts 1 → multiplier 100 unless noted):
//   current_value   = mark * multiplier * sideSign   (long +asset, short -liability)
//   unrealized_pnl  = (mark - entry) * multiplier * sideSign
//   pnl_pct         = unrealized_pnl / (entry * multiplier) * 100   (null when entry 0)
//   breakeven       = strike ± entry  (LONG only; short = null)

// A fixed instant so DTE math is deterministic across machines/timezones.
// 2026-06-23 17:00Z is well inside the 2026-06-23 ET session date.
const NOW = new Date("2026-06-23T17:00:00Z");

function makeRow(overrides: Partial<UserPositionRow> = {}): UserPositionRow {
  return {
    id: 1,
    ticker: "AAPL",
    option_type: "call",
    strike: 100,
    expiry: "2026-07-17",
    side: "long",
    contracts: 1,
    entry_premium: 5,
    entry_date: "2026-06-01",
    status: "open",
    exit_premium: null,
    notes: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

function makeValuation(overrides: Partial<ContractValuation> = {}): ContractValuation {
  return {
    mark: 8,
    bid: 7.9,
    ask: 8.1,
    delta: 0.5,
    gamma: 0.02,
    theta: -0.1,
    iv: 0.3,
    openInterest: 1000,
    underlyingPrice: 105,
    mark_source: "snapshot",
    ...overrides,
  };
}

// ----------------------------- LONG quadrants -----------------------------

test("LONG call: entry 5, mark 8 → +300 pnl, +800 value, +60% , breakeven 105", () => {
  const pos = enrichPosition(
    makeRow({ side: "long", option_type: "call", entry_premium: 5 }),
    makeValuation({ mark: 8 }),
    NOW
  );
  assert.equal(pos.unrealized_pnl, 300);
  assert.equal(pos.current_value, 800);
  assert.equal(pos.pnl_pct, 60);
  assert.equal(pos.breakeven, 105);
  assert.equal(pos.valuation_status, "live");
});

test("LONG put: entry 5, mark 2 → -300 pnl, +200 value, breakeven 95", () => {
  const pos = enrichPosition(
    makeRow({ side: "long", option_type: "put", entry_premium: 5 }),
    makeValuation({ mark: 2 }),
    NOW
  );
  assert.equal(pos.unrealized_pnl, -300);
  assert.equal(pos.current_value, 200); // long = asset value, positive
  assert.equal(pos.breakeven, 95); // strike - entry
});

// ----------------------------- SHORT quadrants -----------------------------

test("SHORT call: entry 5, mark 2 → +300 pnl (profits as mark falls), -200 value (liability), +60%, breakeven null", () => {
  const pos = enrichPosition(
    makeRow({ side: "short", option_type: "call", entry_premium: 5 }),
    makeValuation({ mark: 2 }),
    NOW
  );
  assert.equal(pos.unrealized_pnl, 300); // short profits as premium decays
  assert.equal(pos.current_value, -200); // cost-to-close LIABILITY → negative
  assert.equal(pos.pnl_pct, 60);
  assert.equal(pos.breakeven, null); // breakeven only defined for longs
});

test("SHORT put: entry 5, mark 8 → -300 pnl, -800 value, breakeven null", () => {
  const pos = enrichPosition(
    makeRow({ side: "short", option_type: "put", entry_premium: 5 }),
    makeValuation({ mark: 8 }),
    NOW
  );
  assert.equal(pos.unrealized_pnl, -300);
  assert.equal(pos.current_value, -800); // liability grows as premium rises
  assert.equal(pos.breakeven, null);
});

// ----------------------------- scaling & guards -----------------------------

test("contracts = 3 scales unrealized_pnl and current_value ×3 (pnl_pct unchanged)", () => {
  const one = enrichPosition(
    makeRow({ side: "long", option_type: "call", entry_premium: 5, contracts: 1 }),
    makeValuation({ mark: 8 }),
    NOW
  );
  const three = enrichPosition(
    makeRow({ side: "long", option_type: "call", entry_premium: 5, contracts: 3 }),
    makeValuation({ mark: 8 }),
    NOW
  );
  assert.equal(three.unrealized_pnl, (one.unrealized_pnl as number) * 3);
  assert.equal(three.current_value, (one.current_value as number) * 3);
  assert.equal(three.unrealized_pnl, 900);
  assert.equal(three.current_value, 2400);
  assert.equal(three.pnl_pct, one.pnl_pct); // a ratio — invariant to size
});

test("entry_premium = 0 → pnl_pct null (divide-by-zero guard) but unrealized_pnl still computed", () => {
  const pos = enrichPosition(
    makeRow({ side: "long", option_type: "call", entry_premium: 0 }),
    makeValuation({ mark: 8 }),
    NOW
  );
  assert.equal(pos.pnl_pct, null);
  assert.equal(pos.unrealized_pnl, 800); // (8 - 0) * 100 * 1
  assert.equal(pos.current_value, 800);
});

// -------------------- shares_per_contract (corp-action multiplier) --------------------

test("absent sharesPerContract → defaults to 100 (standard contract, unchanged math)", () => {
  // makeValuation omits sharesPerContract → enrichPosition must fall back to 100.
  const pos = enrichPosition(
    makeRow({ side: "long", option_type: "call", entry_premium: 5, contracts: 1 }),
    makeValuation({ mark: 8 }),
    NOW
  );
  assert.equal(pos.unrealized_pnl, 300); // (8-5)*100*1
  assert.equal(pos.current_value, 800); // 8*100*1
});

test("non-100 sharesPerContract (e.g. 110 after a corp action) scales value + pnl", () => {
  const pos = enrichPosition(
    makeRow({ side: "long", option_type: "call", entry_premium: 5, contracts: 1 }),
    makeValuation({ mark: 8, sharesPerContract: 110 }),
    NOW
  );
  // multiplier = contracts(1) * 110
  assert.equal(pos.current_value, 880); // 8 * 110
  assert.equal(pos.unrealized_pnl, 330); // (8-5) * 110
  assert.equal(pos.pnl_pct, 60); // ratio invariant to multiplier: (8-5)/5
});

test("invalid sharesPerContract (0 / negative / NaN) falls back to 100", () => {
  for (const bad of [0, -100, NaN]) {
    const pos = enrichPosition(
      makeRow({ side: "long", option_type: "call", entry_premium: 5, contracts: 1 }),
      makeValuation({ mark: 8, sharesPerContract: bad }),
      NOW
    );
    assert.equal(pos.current_value, 800, `sharesPerContract=${bad} should default to 100`);
    assert.equal(pos.unrealized_pnl, 300);
  }
});

// ----------------------------- no-valuation states -----------------------------

test("valuation null + pending=true → 'pending', money fields null, but DTE + breakeven still set", () => {
  const pos = enrichPosition(
    makeRow({ side: "long", option_type: "call", entry_premium: 5, expiry: "2026-07-17" }),
    null,
    NOW,
    true
  );
  assert.equal(pos.valuation_status, "pending");
  assert.equal(pos.valuation, null);
  assert.equal(pos.current_value, null);
  assert.equal(pos.unrealized_pnl, null);
  assert.equal(pos.pnl_pct, null);
  assert.equal(pos.breakeven, 105); // computed without a live price
  assert.ok(pos.dte > 0); // future expiry
});

test("valuation null + pending=false → 'unavailable' (still has DTE + breakeven)", () => {
  const pos = enrichPosition(
    makeRow({ side: "long", option_type: "put", entry_premium: 5 }),
    null,
    NOW,
    false
  );
  assert.equal(pos.valuation_status, "unavailable");
  assert.equal(pos.valuation, null);
  assert.equal(pos.breakeven, 95);
});

// ----------------------------- DTE -----------------------------

test("DTE: expiry == today (ET) → 0", () => {
  // NOW is 2026-06-23 17:00Z → ET session date 2026-06-23.
  const pos = enrichPosition(makeRow({ expiry: "2026-06-23" }), makeValuation(), NOW);
  assert.equal(pos.dte, 0);
});

test("DTE: a clearly future expiry → > 0 (and exact for a known gap)", () => {
  const pos = enrichPosition(makeRow({ expiry: "2026-06-30" }), makeValuation(), NOW);
  assert.ok(pos.dte > 0);
  assert.equal(pos.dte, 7); // 2026-06-23 → 2026-06-30
});
