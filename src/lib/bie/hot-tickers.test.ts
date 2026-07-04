import { test } from "node:test";
import assert from "node:assert/strict";
import { filterHotTickers, type HotTicker } from "./hot-tickers";

function row(ticker: string, total_premium = 1_000_000): HotTicker {
  return { ticker, print_count: 3, total_premium };
}

test("filterHotTickers: drops index/ETF names (SPY, QQQ, SPX)", () => {
  const out = filterHotTickers([row("SPY"), row("QQQ"), row("SPX"), row("AAPL")]);
  assert.deepEqual(
    out.map((r) => r.ticker),
    ["AAPL"]
  );
});

test("filterHotTickers: drops leveraged ETPs (TQQQ, SOXL)", () => {
  const out = filterHotTickers([row("TQQQ"), row("SOXL"), row("NVDA")]);
  assert.deepEqual(
    out.map((r) => r.ticker),
    ["NVDA"]
  );
});

test("filterHotTickers: preserves order and all fields for single names", () => {
  const out = filterHotTickers([row("NVDA", 5_000_000), row("TSLA", 2_000_000)]);
  assert.deepEqual(out, [
    { ticker: "NVDA", print_count: 3, total_premium: 5_000_000 },
    { ticker: "TSLA", print_count: 3, total_premium: 2_000_000 },
  ]);
});

test("filterHotTickers: empty input returns empty output", () => {
  assert.deepEqual(filterHotTickers([]), []);
});

test("filterHotTickers: all-excluded input returns empty output, not a crash", () => {
  assert.deepEqual(filterHotTickers([row("SPY"), row("VXX")]), []);
});
