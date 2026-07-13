import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendSessionWallSample,
  loadMultiSessionWallHistory,
  loadSessionWallHistory,
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

test("loadMultiSessionWallHistory: concatenates per-session rails in time order (15-day seed read)", async () => {
  // Two sessions written through the normal append path (shared-cache memory). Times are real
  // epoch-style seconds a day apart so global ascending order is observable.
  const DAY = 24 * 60 * 60;
  const s1 = "2099-03-01";
  const s2 = "2099-03-02";
  const t1 = 1_000_000;
  await appendSessionWallSample(s1, { time: t1, walls: walls(6800, 6700) }, "MULTI");
  await appendSessionWallSample(s1, { time: t1 + 60, walls: walls(6810, 6700) }, "MULTI");
  await appendSessionWallSample(s2, { time: t1 + DAY, walls: walls(6900, 6800) }, "MULTI");

  // Sessions passed NEWEST-first — the loader must still emit oldest-first, time-ascending.
  const rail = await loadMultiSessionWallHistory("MULTI", "all", [s2, s1]);
  assert.deepEqual(rail.map((s) => s.time), [t1, t1 + 60, t1 + DAY]);
  assert.equal(rail[0].walls.callWalls[0].strike, 6800);
  assert.equal(rail[2].walls.callWalls[0].strike, 6900);
});

test("loadMultiSessionWallHistory: a session with nothing recorded is an honest gap, not a failure", async () => {
  const s1 = "2099-04-01";
  await appendSessionWallSample(s1, { time: 2_000_000, walls: walls(6800, 6700) }, "GAPPY");
  const rail = await loadMultiSessionWallHistory("GAPPY", "all", [s1, "2099-04-02", "2099-04-03"]);
  assert.equal(rail.length, 1);
  assert.equal(rail[0].time, 2_000_000);
});

test("loadMultiSessionWallHistory: empty session list / all-empty sessions → []", async () => {
  assert.deepEqual(await loadMultiSessionWallHistory("SPX", "all", []), []);
  assert.deepEqual(await loadMultiSessionWallHistory("SPX", "all", ["", ""]), []);
});

test("loadMultiSessionWallHistory: narrowed horizon reads the composite-keyed rail, not 'all'", async () => {
  const s1 = "2099-05-01";
  await appendSessionWallSample(s1, { time: 3_000_000, walls: walls(6800, 6700) }, "HZN", "all");
  await appendSessionWallSample(s1, { time: 3_000_060, walls: walls(6850, 6750) }, "HZN", "weekly");
  const weekly = await loadMultiSessionWallHistory("HZN", "weekly", [s1]);
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].walls.callWalls[0].strike, 6850);
  const all = await loadMultiSessionWallHistory("HZN", "all", [s1]);
  assert.equal(all.length, 1);
  assert.equal(all[0].walls.callWalls[0].strike, 6800);
});
