import { test } from "node:test";
import assert from "node:assert/strict";
import { recordStockTick, getStockLiveCandle, getStockCandleStoreStats, wsSpotPrice, _resetStockCandleStoreForTest } from "./stock-candle-store";

test("recordStockTick: first tick opens a bar with open=high=low=close", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:30:05.000Z");
  recordStockTick("SPY", 605.5, undefined, atMs);

  const { current } = getStockLiveCandle("SPY");
  assert.ok(current);
  assert.equal(current!.open, 605.5);
  assert.equal(current!.high, 605.5);
  assert.equal(current!.low, 605.5);
  assert.equal(current!.close, 605.5);
  assert.equal(current!.time, Math.floor(atMs / 60_000) * 60);
});

test("recordStockTick: updates high/low/close within same minute", () => {
  _resetStockCandleStoreForTest();
  const base = Date.parse("2026-07-15T14:31:00.000Z");

  recordStockTick("NVDA", 140, undefined, base);
  recordStockTick("NVDA", 142, undefined, base + 10_000);
  recordStockTick("NVDA", 138, undefined, base + 20_000);
  recordStockTick("NVDA", 141, undefined, base + 30_000);

  const { current } = getStockLiveCandle("NVDA");
  assert.equal(current!.open, 140);
  assert.equal(current!.high, 142);
  assert.equal(current!.low, 138);
  assert.equal(current!.close, 141);
});

test("recordStockTick: next minute opens a new bar", () => {
  _resetStockCandleStoreForTest();
  const m1 = Date.parse("2026-07-15T14:32:00.000Z");
  const m2 = Date.parse("2026-07-15T14:33:05.000Z");

  recordStockTick("AAPL", 230, undefined, m1);
  recordStockTick("AAPL", 232, undefined, m1 + 30_000);
  recordStockTick("AAPL", 235, undefined, m2);

  const { current } = getStockLiveCandle("AAPL");
  assert.equal(current!.open, 235);
  assert.equal(current!.time, Math.floor(m2 / 60_000) * 60);
});

test("recordStockTick: ignores non-finite and non-positive prices", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:34:00.000Z");
  recordStockTick("META", 520, undefined, atMs);
  const before = getStockLiveCandle("META").current;

  recordStockTick("META", NaN, undefined, atMs + 1000);
  recordStockTick("META", 0, undefined, atMs + 2000);
  recordStockTick("META", -5, undefined, atMs + 3000);

  assert.deepEqual(getStockLiveCandle("META").current, before);
});

test("recordStockTick: late tick from prior minute is dropped", () => {
  _resetStockCandleStoreForTest();
  const m0 = Date.parse("2026-07-15T14:35:00.000Z");
  const m1 = Date.parse("2026-07-15T14:36:00.000Z");

  recordStockTick("TSLA", 280, undefined, m0 + 1_000);
  recordStockTick("TSLA", 285, undefined, m1 + 1_000);
  recordStockTick("TSLA", 283, undefined, m1 + 2_000);
  recordStockTick("TSLA", 275, undefined, m0 + 59_000); // late tick from m0

  const snap = getStockLiveCandle("TSLA");
  assert.equal(snap.current?.time, Math.floor(m1 / 60_000) * 60);
  assert.equal(snap.current?.open, 285);
  assert.equal(snap.current?.low, 283);
});

test("recordStockTick: normalizes ticker to uppercase", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:37:00.000Z");

  recordStockTick("spy", 605, undefined, atMs);
  const snap = getStockLiveCandle("SPY");
  assert.ok(snap.current);
  assert.equal(snap.current!.close, 605);
});

test("recordStockTick: tracks volume when provided", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:38:00.000Z");

  recordStockTick("AMD", 180, 50000, atMs);
  const snap = getStockLiveCandle("AMD");
  assert.equal(snap.current!.volume, 50000);
});

test("getStockLiveCandle: returns null for unknown ticker", () => {
  _resetStockCandleStoreForTest();
  const snap = getStockLiveCandle("ZZZZ");
  assert.equal(snap.current, null);
  assert.equal(snap.updatedAt, 0);
});

test("separate tickers have independent state", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:40:00.000Z");

  recordStockTick("SPY", 605, undefined, atMs);
  recordStockTick("QQQ", 525, undefined, atMs);

  assert.equal(getStockLiveCandle("SPY").current!.close, 605);
  assert.equal(getStockLiveCandle("QQQ").current!.close, 525);
});

test("getStockLiveCandle marks ticker as demanded for on-demand Redis writes", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:41:00.000Z");

  recordStockTick("TSLA", 280, undefined, atMs);
  recordStockTick("AAPL", 230, undefined, atMs);

  const stats1 = getStockCandleStoreStats();
  assert.equal(stats1.total, 2);
  assert.equal(stats1.demanded, 0);

  getStockLiveCandle("TSLA");

  const stats2 = getStockCandleStoreStats();
  assert.equal(stats2.total, 2);
  assert.equal(stats2.demanded, 1);

  getStockLiveCandle("AAPL");
  const stats3 = getStockCandleStoreStats();
  assert.equal(stats3.demanded, 2);
});

test("getStockCandleStoreStats: tracks total tickers in memory", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:42:00.000Z");

  assert.equal(getStockCandleStoreStats().total, 0);

  for (let i = 0; i < 100; i++) {
    recordStockTick(`T${i}`, 100 + i, undefined, atMs);
  }
  assert.equal(getStockCandleStoreStats().total, 100);
  assert.equal(getStockCandleStoreStats().demanded, 0);
});

test("wsSpotPrice: returns price for fresh ticker", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:43:00.000Z");
  recordStockTick("MSFT", 460, undefined, atMs);
  const price = wsSpotPrice("MSFT");
  assert.equal(price, 460);
  assert.equal(getStockCandleStoreStats().demanded, 1);
});

test("wsSpotPrice: returns null for unknown ticker", () => {
  _resetStockCandleStoreForTest();
  assert.equal(wsSpotPrice("UNKNOWN"), null);
});

test("wsSpotPrice: normalizes to uppercase", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:44:00.000Z");
  recordStockTick("GOOG", 195, undefined, atMs);
  assert.equal(wsSpotPrice("goog"), 195);
});
