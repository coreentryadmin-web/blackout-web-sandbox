import { test, mock } from "node:test";
import assert from "node:assert/strict";

const state = { sessionDate: "2026-07-06" };

mock.module("../providers/spx-session", {
  namedExports: {
    todayEtYmd: () => state.sessionDate,
  },
});

// Controllable stand-ins for the cross-replica Redis fallback. Each fallback test resets
// these before use; `sharedCacheSetCalls` counts invocations for the write-throttle test.
const sharedCache = { getResult: null as unknown, setCalls: 0 };
mock.module("../shared-cache", {
  namedExports: {
    sharedCacheGet: async () => sharedCache.getResult,
    sharedCacheSet: async () => {
      sharedCache.setCalls += 1;
    },
  },
});

// Lazy import so the todayEtYmd mock above is in place before the module under test resolves it.
const mod = () => import("./spx-candle-store");

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 10));

test("recordSpxTick: first tick opens a bar with open=high=low=close", async () => {
  const { recordSpxTick, getCurrentSpxCandle } = await mod();
  state.sessionDate = "2026-07-06T1";
  const atMs = Date.parse("2026-07-06T14:30:05.000Z");

  recordSpxTick(6420.5, atMs);

  const { current } = getCurrentSpxCandle();
  assert.ok(current);
  assert.equal(current!.open, 6420.5);
  assert.equal(current!.high, 6420.5);
  assert.equal(current!.low, 6420.5);
  assert.equal(current!.close, 6420.5);
  assert.equal(current!.time, Math.floor(atMs / 60_000) * 60);
});

test("recordSpxTick: ticks within the same minute update high/low/close but keep open", async () => {
  const { recordSpxTick, getCurrentSpxCandle } = await mod();
  state.sessionDate = "2026-07-06T2";
  const base = Date.parse("2026-07-06T14:31:00.000Z");

  recordSpxTick(6400, base);
  recordSpxTick(6410, base + 10_000); // up-wick
  recordSpxTick(6390, base + 20_000); // down-wick
  recordSpxTick(6405, base + 30_000); // close

  const { current } = getCurrentSpxCandle();
  assert.equal(current!.open, 6400);
  assert.equal(current!.high, 6410);
  assert.equal(current!.low, 6390);
  assert.equal(current!.close, 6405);
});

test("recordSpxTick: a tick in the next minute closes the prior bar into history and opens a new one", async () => {
  const { recordSpxTick, getCurrentSpxCandle } = await mod();
  state.sessionDate = "2026-07-06T3";
  const minute1 = Date.parse("2026-07-06T14:32:00.000Z");
  const minute2 = Date.parse("2026-07-06T14:33:05.000Z");

  recordSpxTick(6400, minute1);
  recordSpxTick(6415, minute1 + 30_000);
  recordSpxTick(6420, minute2);

  const { current } = getCurrentSpxCandle();
  assert.equal(current!.open, 6420);
  assert.equal(current!.high, 6420);
  assert.equal(current!.time, Math.floor(minute2 / 60_000) * 60);
});

test("recordSpxTick: non-finite or non-positive prices are ignored", async () => {
  const { recordSpxTick, getCurrentSpxCandle } = await mod();
  state.sessionDate = "2026-07-06T4";
  const atMs = Date.parse("2026-07-06T14:34:00.000Z");
  recordSpxTick(6400, atMs);
  const before = getCurrentSpxCandle().current;

  recordSpxTick(NaN, atMs + 1000);
  recordSpxTick(0, atMs + 2000);
  recordSpxTick(-5, atMs + 3000);

  assert.deepEqual(getCurrentSpxCandle().current, before);
});

test("recordSpxTick: a new ET session date resets the aggregator (no stale prior-day bar)", async () => {
  const { recordSpxTick, getCurrentSpxCandle } = await mod();
  state.sessionDate = "2026-07-06T5";
  recordSpxTick(6400, Date.parse("2026-07-06T20:59:00.000Z"));
  assert.ok(getCurrentSpxCandle().current);

  state.sessionDate = "2026-07-07T5"; // next trading day
  recordSpxTick(6450, Date.parse("2026-07-07T13:30:00.000Z"));

  const { current } = getCurrentSpxCandle();
  assert.equal(current!.open, 6450);
});

test("getCurrentSpxCandle: falls back to the cross-replica Redis snapshot when local state has never ticked (non-leader replica)", async () => {
  const { getCurrentSpxCandle, _resetSpxCandleStoreForTest } = await mod();
  _resetSpxCandleStoreForTest();
  const fallback = { current: { time: 1000, open: 1, high: 2, low: 1, close: 2 }, updatedAt: 12345 };
  sharedCache.getResult = fallback;

  // First read: local state is empty, so it returns null synchronously while the Redis
  // fetch runs in the background — matches the observed live-production behavior (the first
  // SSE tick on a freshly-touched replica is null; the fetch resolves on the next tick).
  assert.deepEqual(getCurrentSpxCandle(), { current: null, updatedAt: 0 });

  await flushMicrotasks();

  assert.deepEqual(getCurrentSpxCandle(), fallback);
});

test("getCurrentSpxCandle: stays null when local state is empty and the Redis fallback has nothing either", async () => {
  const { getCurrentSpxCandle, _resetSpxCandleStoreForTest } = await mod();
  _resetSpxCandleStoreForTest();
  sharedCache.getResult = null;

  getCurrentSpxCandle();
  await flushMicrotasks();

  assert.deepEqual(getCurrentSpxCandle(), { current: null, updatedAt: 0 });
});

test("getCurrentSpxCandle: fresh local state wins over the Redis fallback once a tick has been recorded", async () => {
  const { recordSpxTick, getCurrentSpxCandle, _resetSpxCandleStoreForTest } = await mod();
  _resetSpxCandleStoreForTest();
  sharedCache.getResult = { current: { time: 999, open: 9, high: 9, low: 9, close: 9 }, updatedAt: 1 };
  state.sessionDate = "2026-07-08T1";

  recordSpxTick(6500, Date.parse("2026-07-08T14:00:00.000Z"));
  await flushMicrotasks();

  const { current } = getCurrentSpxCandle();
  assert.equal(current!.open, 6500); // the real local tick, never the stale fallback fixture
});

test("getCurrentSpxCandle: stale local state yields to a fresher cross-replica Redis snapshot", async () => {
  const {
    recordSpxTick,
    getCurrentSpxCandle,
    _resetSpxCandleStoreForTest,
    _ageLocalCandleForTest,
  } = await mod();
  _resetSpxCandleStoreForTest();
  state.sessionDate = "2026-07-08T3";
  const atMs = Date.parse("2026-07-08T14:10:00.000Z");

  recordSpxTick(6400, atMs);
  assert.equal(getCurrentSpxCandle().current!.open, 6400);

  const fresher = {
    current: { time: Math.floor(atMs / 60_000) * 60, open: 6410, high: 6415, low: 6408, close: 6412 },
    updatedAt: Date.now(),
  };
  sharedCache.getResult = fresher;
  _ageLocalCandleForTest(10_000);

  getCurrentSpxCandle();
  await flushMicrotasks();

  const snap = getCurrentSpxCandle();
  assert.equal(snap.current!.close, 6412);
  assert.equal(snap.updatedAt, fresher.updatedAt);
});

test("recordSpxTick: throttles the cross-replica Redis write instead of writing on every tick", async () => {
  const { recordSpxTick, _resetSpxCandleStoreForTest } = await mod();
  _resetSpxCandleStoreForTest();
  sharedCache.setCalls = 0;
  state.sessionDate = "2026-07-08T2";
  const base = Date.parse("2026-07-08T14:05:00.000Z");

  recordSpxTick(6500, base);
  recordSpxTick(6501, base + 100);
  recordSpxTick(6502, base + 200);
  await flushMicrotasks();

  assert.equal(sharedCache.setCalls, 1);
});
