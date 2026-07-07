import { test, mock } from "node:test";
import assert from "node:assert/strict";

const state = { sessionDate: "2026-07-06" };

mock.module("../providers/spx-session", {
  namedExports: {
    todayEtYmd: () => state.sessionDate,
  },
});

// Lazy import so the todayEtYmd mock above is in place before the module under test resolves it.
const mod = () => import("./spx-candle-store");

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
