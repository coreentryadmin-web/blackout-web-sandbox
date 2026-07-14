import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendSessionWallSample,
  loadSessionWallHistory,
  loadMultiSessionWallHistory,
  loadRecentWallHistory,
  persistWallSampleDebounced,
  _resetWallPersistDebounceForTest,
} from "./vector-wall-persist";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";

const SESSION = "2099-01-02";

function walls(call: number, put: number): GexWalls {
  return {
    callWalls: [{ strike: call, pct: 10 }],
    putWalls: [{ strike: put, pct: 8 }],
  };
}

test("appendSessionWallSample + loadSessionWallHistory round-trip via shared-cache memory", async () => {
  await appendSessionWallSample(SESSION, { time: 100, walls: walls(6800, 6700) });
  await appendSessionWallSample(SESSION, { time: 160, walls: walls(6810, 6700) });
  const loaded = await loadSessionWallHistory(SESSION);
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded.map((s) => s.time), [100, 160]);
  assert.equal(loaded[1].walls.callWalls[0].strike, 6810);
});

test("appendSessionWallSample replaces in-place for the same bar time", async () => {
  const session = "2099-01-03";
  await appendSessionWallSample(session, { time: 200, walls: walls(6800, 6700) });
  await appendSessionWallSample(session, { time: 200, walls: walls(6825, 6700) });
  const loaded = await loadSessionWallHistory(session);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].walls.callWalls[0].strike, 6825);
});

test("appendSessionWallSample returns true when a sample lands, false when sessionYmd is empty", async () => {
  // The boolean return is what lets the cron tally how many samples actually landed —
  // the signal that was missing when a silent persistence gap emptied the off-hours rail.
  const session = "2099-01-05";
  assert.equal(await appendSessionWallSample(session, { time: 500, walls: walls(6800, 6700) }), true);
  // A missing session id is never persisted — guarded before any cache touch.
  assert.equal(await appendSessionWallSample("", { time: 1, walls: walls(1, 1) }), false);
});

test("persistWallSampleDebounced: coalesces rapid writes in the same bucket", async () => {
  _resetWallPersistDebounceForTest();
  const session = "2099-01-04";
  const sample = { time: 300, walls: walls(6800, 6700) };
  persistWallSampleDebounced(session, sample);
  persistWallSampleDebounced(session, sample);
  await new Promise((r) => setTimeout(r, 50));
  const loaded = await loadSessionWallHistory(session);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].time, 300);
});

test("per-horizon rails are stored + read independently; 'all' stays on the legacy key", async () => {
  const session = "2099-02-01";
  // Same ticker, three horizons — each records its OWN trail.
  await appendSessionWallSample(session, { time: 100, walls: walls(220, 190) }, "NVDA", "all");
  await appendSessionWallSample(session, { time: 100, walls: walls(210, 195) }, "NVDA", "weekly");
  await appendSessionWallSample(session, { time: 160, walls: walls(208, 196) }, "NVDA", "weekly");

  const all = await loadSessionWallHistory(session, "NVDA", "all");
  const weekly = await loadSessionWallHistory(session, "NVDA", "weekly");
  const monthly = await loadSessionWallHistory(session, "NVDA", "monthly");

  assert.equal(all.length, 1, "all rail has its own single sample");
  assert.equal(all[0].walls.callWalls[0].strike, 220);
  assert.equal(weekly.length, 2, "weekly rail accumulated independently");
  assert.deepEqual(weekly.map((s) => s.walls.callWalls[0].strike), [210, 208]);
  assert.equal(monthly.length, 0, "an unrecorded horizon is empty, not cross-contaminated");

  // Backward-compat: default horizon ('all') reads the SAME data as the legacy 2-arg call.
  const legacy = await loadSessionWallHistory(session, "NVDA");
  assert.deepEqual(legacy, all, "2-arg load == horizon:'all' load (legacy key unchanged)");
});

test("wallRailStorageId: 'all' is the bare ticker; narrowed horizons get a composite key", async () => {
  const { wallRailStorageId } = await import("./vector-wall-persist");
  assert.equal(wallRailStorageId("NVDA", "all"), "NVDA");
  assert.equal(wallRailStorageId("NVDA"), "NVDA");
  assert.equal(wallRailStorageId("NVDA", "weekly"), "NVDA::weekly");
  assert.equal(wallRailStorageId("SPX", "0dte"), "SPX::0dte");
});

// ---- MULTI-SESSION continuity (GAP A) — reads span >1 session, prior days decimated + tagged ----

test("loadMultiSessionWallHistory: concatenates multiple sessions in ascending time order", async () => {
  const T = "MULTISESS";
  await appendSessionWallSample("2099-03-05", { time: 1000, walls: walls(100, 90) }, T, "weekly");
  await appendSessionWallSample("2099-03-05", { time: 1060, walls: walls(101, 90) }, T, "weekly");
  await appendSessionWallSample("2099-03-06", { time: 90000, walls: walls(110, 95) }, T, "weekly");
  // Sessions passed out of order — the loader sorts + concatenates them time-ascending.
  const rail = await loadMultiSessionWallHistory(T, "weekly", ["2099-03-06", "2099-03-05"]);
  assert.deepEqual(rail.map((s) => s.time), [1000, 1060, 90000]);
  // A horizon with nothing recorded stays an honest empty gap (never fabricated).
  assert.deepEqual(await loadMultiSessionWallHistory(T, "monthly", ["2099-03-05"]), []);
  assert.deepEqual(await loadMultiSessionWallHistory(T, "weekly", []), []);
});

test("loadRecentWallHistory: latest session full-res + PRIOR sessions decimated & tagged historical", async () => {
  const T = "RECENTSESS";
  // Prior session: six 15s samples all inside ONE 2-min bucket → decimated to the bucket's LAST.
  for (let i = 0; i < 6; i++) {
    await appendSessionWallSample("2099-04-01", { time: 1000 + i * 15, walls: walls(100 + i, 90) }, T, "0dte");
  }
  // Latest session: kept at full resolution, NOT tagged historical.
  await appendSessionWallSample("2099-04-02", { time: 200000, walls: walls(110, 95) }, T, "0dte");
  await appendSessionWallSample("2099-04-02", { time: 200060, walls: walls(111, 95) }, T, "0dte");

  const rail = await loadRecentWallHistory(T, "0dte", ["2099-04-01", "2099-04-02"]);
  const prior = rail.filter((s) => s.historical);
  const latest = rail.filter((s) => !s.historical);
  assert.equal(prior.length, 1, "6 prior samples in one 120s bucket decimate to 1");
  assert.equal(prior[0].walls.callWalls[0].strike, 105, "decimation keeps the bucket's LAST sample");
  assert.equal(latest.length, 2, "latest session kept full-res");
  // Globally time-ascending (prior day precedes the latest session).
  assert.ok(rail.every((s, i) => i === 0 || rail[i - 1].time <= s.time));
  // Single-session window: no prior rail, nothing tagged historical.
  const single = await loadRecentWallHistory(T, "0dte", ["2099-04-02"]);
  assert.ok(single.length >= 2 && single.every((s) => !s.historical));
});
