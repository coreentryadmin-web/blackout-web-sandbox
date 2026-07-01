import { test } from "node:test";
import assert from "node:assert/strict";
import { isEtMarketHours, tickerShard } from "./et-market-hours";

test("tickerShard is stable and in range", () => {
  const a = tickerShard("NVDA", 6);
  const b = tickerShard("NVDA", 6);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 6);
});

test("tickerShard spreads tickers", () => {
  const shards = new Set(["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "AMD"].map((t) => tickerShard(t, 6)));
  assert.ok(shards.size >= 2);
});

test("isEtMarketHours rejects weekend", () => {
  // 2026-06-28 is a Sunday noon ET
  const sun = new Date("2026-06-28T16:00:00.000Z");
  assert.equal(isEtMarketHours(sun), false);
});
