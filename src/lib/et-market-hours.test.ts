import { test } from "node:test";
import assert from "node:assert/strict";
import { isEtMarketHours, isEtExtendedWarmHours, tickerShard } from "./et-market-hours";

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

test("isEtMarketHours rejects NYSE full-day holidays during cash hours", () => {
  // 2026-07-03 is Independence Day observed (NYSE closed) — 10:30 AM ET
  const holiday = new Date("2026-07-03T14:30:00.000Z");
  assert.equal(isEtMarketHours(holiday), false);
});

// Regression: the RTH warm leader used to gate on isEtCashRth (9:30 AM-4:00 PM ET only), so
// cache warming for grid/heatmap/desk/nights-watch stopped dead at the close and stayed off
// until the next open — every evening/pre-market visit forced a cold cache rebuild. Reproduced
// live 2026-07-06 ~18:41 ET (well past the 4:00 PM cutoff): SPX desk 4.5s, GEX heatmap 2.4s,
// 0DTE board 1.8s cold vs <150ms warm. See docs/audit/FINDINGS.md.
test("isEtExtendedWarmHours covers pre-market and after-hours on a weekday (2026-07-06, a Monday)", () => {
  // 6:00 AM ET
  assert.equal(isEtExtendedWarmHours(new Date("2026-07-06T10:00:00.000Z")), true);
  // 6:41 PM ET — the exact time the live slowness was reproduced
  assert.equal(isEtExtendedWarmHours(new Date("2026-07-06T22:41:00.000Z")), true);
  // Cash RTH itself (noon ET) must still be covered
  assert.equal(isEtExtendedWarmHours(new Date("2026-07-06T16:00:00.000Z")), true);
});

test("isEtExtendedWarmHours excludes the dead-of-night gap (before 4 AM / after 8 PM ET)", () => {
  // 2:00 AM ET
  assert.equal(isEtExtendedWarmHours(new Date("2026-07-06T06:00:00.000Z")), false);
  // 9:00 PM ET
  assert.equal(isEtExtendedWarmHours(new Date("2026-07-07T01:00:00.000Z")), false);
});

test("isEtExtendedWarmHours still rejects weekends and NYSE holidays", () => {
  const sun = new Date("2026-06-28T16:00:00.000Z");
  assert.equal(isEtExtendedWarmHours(sun), false);
  const holiday = new Date("2026-07-03T14:30:00.000Z");
  assert.equal(isEtExtendedWarmHours(holiday), false);
});
