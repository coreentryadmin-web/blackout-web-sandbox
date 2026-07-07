// Hermetic: extractCandidateTickers consults Postgres (baseline premium + streaks)
// when a DATABASE_URL is present. These are pure-logic tests — blank the env BEFORE
// any import so dbConfigured() reads false at call time and no connection is attempted
// (the audit sandbox has the env set but Postgres TCP blocked → 10s hangs otherwise).
process.env.DATABASE_URL = "";
process.env.DATABASE_PUBLIC_URL = "";

import assert from "node:assert/strict";
import test from "node:test";
import { isExcludedInstrument, extractCandidateTickers } from "./candidates";
import { computeFlowStreakFromBuckets } from "./flow-streak";

// Batch C regression suite (2026-07-02 audit): discovery-quality filters,
// cross-source seeds, and consecutive-trading-day streaks.

// ── instrument filter ────────────────────────────────────────────────────────────

test("excludes leveraged/inverse ETPs and VIX wrappers", () => {
  for (const t of ["TQQQ", "SQQQ", "SOXL", "UVXY", "VXX", "NVDL", "TSLL"]) {
    assert.equal(isExcludedInstrument(t), true, t);
  }
});

test("excludes SPAC-suffix warrants/units/rights", () => {
  for (const t of ["ABCDW", "ABCDU", "ABCDR", "ACME.WS", "ACME-WT", "FOO.U"]) {
    assert.equal(isExcludedInstrument(t), true, t);
  }
});

test("keeps normal single names incl. 4-letter tickers ending in W/U/R", () => {
  for (const t of ["NVDA", "AMD", "MRK", "SNOW", "BIDU", "THOR", "XOM", "A"]) {
    assert.equal(isExcludedInstrument(t), false, t);
  }
});

// ── candidate extraction: floor, exclusion, cross-source ────────────────────────

function flowRow(ticker: string, prem: number, extra: Record<string, unknown> = {}) {
  return { ticker, total_premium: prem, strike: 100, expiry: "2026-08-21", ...extra };
}

test("penny names are dropped only when a row carried the underlying price", async () => {
  const flows = [
    flowRow("PENY", 900_000, { underlying_price: 0.8 }),
    flowRow("REAL", 900_000, { underlying_price: 42 }),
    flowRow("NOPX", 900_000), // no price on the row — must NOT be evicted
  ];
  const out = await extractCandidateTickers(flows, [], 10);
  assert.ok(!out.includes("PENY"));
  assert.ok(out.includes("REAL"));
  assert.ok(out.includes("NOPX"));
});

test("leveraged ETPs never reach the candidate list", async () => {
  const flows = [flowRow("TQQQ", 5_000_000), flowRow("NVDA", 1_000_000)];
  const out = await extractCandidateTickers(flows, [], 10);
  assert.deepEqual(out, ["NVDA"]);
});

test("top-net-impact rows seed candidates (cross-source corroboration)", async () => {
  const out = await extractCandidateTickers([], [], 10, {
    topNetImpact: [{ ticker: "CORR", net_premium: 2_000_000 }],
  });
  assert.deepEqual(out, ["CORR"]);
});

// ── streak continuity ────────────────────────────────────────────────────────────

test("streak counts consecutive trading days, not bucket entries", () => {
  // Mon 06-29, skip Tue, Wed 07-01 — same direction but NOT consecutive.
  const gappy = [
    { day: "2026-07-01", net: 500_000, call: 1, put: 0 },
    { day: "2026-06-29", net: 400_000, call: 1, put: 0 },
  ];
  assert.equal(computeFlowStreakFromBuckets(gappy).streak_days, 1);

  const consecutive = [
    { day: "2026-07-01", net: 500_000, call: 1, put: 0 },
    { day: "2026-06-30", net: 400_000, call: 1, put: 0 },
    { day: "2026-06-29", net: 300_000, call: 1, put: 0 },
  ];
  assert.equal(computeFlowStreakFromBuckets(consecutive).streak_days, 3);
});

test("weekends and the 2026-07-03 holiday do not break a streak", () => {
  // Thu 07-02 ← (Fri holiday, weekend) ← Mon 07-06: consecutive TRADING days.
  const spanning = [
    { day: "2026-07-06", net: 500_000, call: 1, put: 0 },
    { day: "2026-07-02", net: 400_000, call: 1, put: 0 },
    { day: "2026-07-01", net: 300_000, call: 1, put: 0 },
  ];
  assert.equal(computeFlowStreakFromBuckets(spanning).streak_days, 3);
});

test("direction flip still breaks the streak", () => {
  const flipped = [
    { day: "2026-07-01", net: 500_000, call: 1, put: 0 },
    { day: "2026-06-30", net: -400_000, call: 0, put: 1 },
  ];
  assert.equal(computeFlowStreakFromBuckets(flipped).streak_days, 1);
});
