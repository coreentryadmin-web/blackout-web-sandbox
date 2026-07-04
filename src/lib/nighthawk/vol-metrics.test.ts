import { test } from "node:test";
import assert from "node:assert/strict";
import { latestRow, parseLatestImpliedVol, parseLatestRiskReversalSkew } from "./vol-metrics";

// Real UW `/api/stock/{ticker}/volatility/realized` row shape — confirmed via a live pull
// against SPX on 2026-07-04 (see spx-signal-log.ts's resolveVolDivergenceReading doc comment).
function realizedVolRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    date: "2025-07-03",
    price: "6279.35",
    implied_volatility: "0.131000",
    realized_volatility: "0.087404",
    unshifted_rv_date: "2025-08-01",
    ...overrides,
  };
}

test("latestRow: returns null for an empty row list", () => {
  assert.equal(latestRow([]), null);
});

test("latestRow: returns the single row unsorted-input case", () => {
  const row = realizedVolRow();
  assert.deepEqual(latestRow([row]), row);
});

test("latestRow: returns the row with the MOST RECENT date, regardless of input order", () => {
  const older = realizedVolRow({ date: "2025-07-01" });
  const newer = realizedVolRow({ date: "2025-07-10" });
  assert.deepEqual(latestRow([older, newer]), newer);
  assert.deepEqual(latestRow([newer, older]), newer);
});

test("parseLatestImpliedVol: reads implied_volatility from UW's combined realized/implied row", () => {
  const iv = parseLatestImpliedVol([realizedVolRow()]);
  assert.equal(iv, 0.131);
});

test("parseLatestImpliedVol: null for an empty row list", () => {
  assert.equal(parseLatestImpliedVol([]), null);
});

test("parseLatestImpliedVol: null (not zero) when the field is missing or non-positive", () => {
  assert.equal(parseLatestImpliedVol([{ date: "2025-07-03" }]), null);
  assert.equal(parseLatestImpliedVol([{ date: "2025-07-03", implied_volatility: "0" }]), null);
});

test("parseLatestImpliedVol + parseLatestRealizedVol read the SAME row independently — realized/implied vol shadow factor sources both from one UW call", () => {
  const rows = [realizedVolRow({ date: "2025-07-01" }), realizedVolRow({ date: "2025-07-05", implied_volatility: "0.14", realized_volatility: "0.09" })];
  const iv = parseLatestImpliedVol(rows);
  const date = String(latestRow(rows)?.date);
  assert.equal(iv, 0.14);
  assert.equal(date, "2025-07-05");
});

test("parseLatestRiskReversalSkew: reads the live UW field name (`risk_reversal`)", () => {
  // Real shape from a live pull against SPY on 2026-07-04: {"date":"2026-07-02","ticker":"SPY","delta":25,"risk_reversal":"0.0663361729210146"}
  const skew = parseLatestRiskReversalSkew([
    { date: "2026-07-02", ticker: "SPY", delta: 25, risk_reversal: "0.0663361729210146" },
  ]);
  assert.ok(skew != null && Math.abs(skew - 0.0663361729210146) < 1e-9);
});
