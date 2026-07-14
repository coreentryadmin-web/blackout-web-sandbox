import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchVectorSeedBars } from "./vector-seed-bars";

test("fetchVectorSeedBars: merges SPY volume onto SPX bars by time", async () => {
  const bars = await fetchVectorSeedBars(
    "SPX",
    new Date("2026-07-06T15:00:00Z"),
    async (sym, from) => {
      if (from !== "2026-07-06") return [];
      if (sym === "I:SPX") {
        return [{ t: 1783368180000, o: 7500, h: 7510, l: 7490, c: 7505 }];
      }
      return [];
    },
    async () => [],
    async () => new Map([[Math.floor(1783368180000 / 1000), 42000]])
  );
  assert.equal(bars.bars[0]?.volume, 42000);
});

test("fetchVectorSeedBars: uses today when bars exist", async () => {
  const bars = await fetchVectorSeedBars(
    "SPX",
    new Date("2026-07-06T15:00:00Z"),
    async (sym, from) => {
      if (from === "2026-07-06" && sym === "I:SPX") {
        return [{ t: 1783368180000, o: 7500, h: 7510, l: 7490, c: 7505 }];
      }
      return [];
    }
  );
  assert.equal(bars.sessionYmd, "2026-07-06");
  assert.equal(bars.bars.length, 1);
  assert.equal(bars.bars[0]?.close, 7505);
});

test("fetchVectorSeedBars: stock ticker uses stock minute bars", async () => {
  const bars = await fetchVectorSeedBars(
    "NVDA",
    new Date("2026-07-06T15:00:00Z"),
    async () => [],
    async (_t, from) => {
      if (from === "2026-07-06") {
        return [{ t: 1783368180000, o: 140, h: 141, l: 139, c: 140.5, v: 1000 }];
      }
      return [];
    }
  );
  assert.equal(bars.ticker, "NVDA");
  assert.equal(bars.bars[0]?.volume, 1000);
});

test("fetchVectorSeedBars: seeds today plus prior sessions, ascending unique time, latest sessionYmd", async () => {
  // Every queried day returns one bar whose timestamp is derived from that day, so older
  // sessions naturally have smaller times — lets us assert ascending order across boundaries.
  const queried: string[] = [];
  const res = await fetchVectorSeedBars(
    "SPX",
    new Date("2026-07-06T15:00:00Z"),
    async (sym, from) => {
      queried.push(from);
      if (sym !== "I:SPX") return [];
      const t = new Date(`${from}T14:30:00Z`).getTime();
      return [{ t, o: 7500, h: 7510, l: 7490, c: 7505 }];
    },
    async () => [],
    async () => new Map()
  );

  // Multiple sessions seeded (today + prior context), not a single session.
  assert.ok(res.bars.length >= 2, `expected multiple sessions, got ${res.bars.length}`);
  // sessionYmd stays pinned to the LATEST (today) session, not the oldest one included.
  assert.equal(res.sessionYmd, "2026-07-06");
  assert.equal(queried[0], "2026-07-06");
  // Strictly ascending + unique timestamps across the concatenated sessions.
  for (let i = 1; i < res.bars.length; i++) {
    assert.ok(
      res.bars[i]!.time > res.bars[i - 1]!.time,
      `timestamps must strictly ascend at index ${i}`
    );
  }
});

test("fetchVectorSeedBars: weekend — latest session is Friday, still with prior context", async () => {
  // now = Sunday 2026-07-12; Friday is 2026-07-10. Return bars for Fri + two prior sessions.
  const withData = new Set(["2026-07-10", "2026-07-09", "2026-07-08"]);
  const res = await fetchVectorSeedBars(
    "SPX",
    new Date("2026-07-12T15:00:00Z"),
    async (sym, from) => {
      if (sym !== "I:SPX" || !withData.has(from)) return [];
      const t = new Date(`${from}T14:30:00Z`).getTime();
      return [{ t, o: 7500, h: 7510, l: 7490, c: 7505 }];
    },
    async () => [],
    async () => new Map()
  );
  // Latest session becomes Friday (today/weekend had no bars), and prior days seed context.
  assert.equal(res.sessionYmd, "2026-07-10");
  assert.ok(res.bars.length >= 2, `expected Friday + prior context, got ${res.bars.length}`);
  for (let i = 1; i < res.bars.length; i++) {
    assert.ok(res.bars[i]!.time > res.bars[i - 1]!.time, "ascending across sessions");
  }
});

test("fetchVectorSeedBars: falls back to prior trading day when today is empty", async () => {
  const calls: string[] = [];
  const bars = await fetchVectorSeedBars(
    "SPX",
    new Date("2026-07-07T05:00:00Z"),
    async (sym, from) => {
      calls.push(`${sym}:${from}`);
      if (from === "2026-07-06" && sym === "I:SPX") {
        return [{ t: 1783368180000, o: 7530, h: 7540, l: 7520, c: 7537.43 }];
      }
      return [];
    },
    async () => [],
    async (ymd) => {
      calls.push(`vol:${ymd}`);
      return new Map();
    }
  );
  assert.ok(calls.includes("I:SPX:2026-07-07"));
  assert.ok(calls.includes("I:SPX:2026-07-06"));
  assert.ok(calls.includes("vol:2026-07-06"));
  assert.equal(bars.sessionYmd, "2026-07-06");
  assert.equal(bars.bars[0]?.close, 7537.43);
});

// ── 22-session multi-day seed (30-day-retention decision) ────────────────────────────────────

/** Fixture: every queried day returns a full fake session of `perDay` 1m bars from 13:30 UTC. */
function daysFetcher(perDay: number, queried?: string[]) {
  return async (_sym: string, from: string) => {
    queried?.push(from);
    const t0 = new Date(`${from}T13:30:00Z`).getTime();
    return Array.from({ length: perDay }, (_, i) => ({
      t: t0 + i * 60_000,
      o: 7500,
      h: 7510,
      l: 7490,
      c: 7505,
    }));
  };
}

test("fetchVectorSeedBars: seeds 22 sessions by default, sessionYmds ascending, latest start exposed", async () => {
  const queried: string[] = [];
  const res = await fetchVectorSeedBars(
    "SPX",
    new Date("2026-07-06T15:00:00Z"),
    daysFetcher(10, queried),
    async () => [],
    async () => new Map()
  );
  assert.equal(res.sessionYmds.length, 22, "22 trading sessions included");
  assert.equal(res.sessionYmd, "2026-07-06");
  assert.equal(res.sessionYmds[res.sessionYmds.length - 1], "2026-07-06", "ascending — latest last");
  const sorted = [...res.sessionYmds].sort();
  assert.deepEqual(res.sessionYmds, sorted, "sessionYmds ascending");
  // latestSessionStartSec = the latest session's first bar (13:30 UTC on 2026-07-06).
  assert.equal(res.latestSessionStartSec, Math.floor(new Date("2026-07-06T13:30:00Z").getTime() / 1000));
  for (let i = 1; i < res.bars.length; i++) {
    assert.ok(res.bars[i]!.time > res.bars[i - 1]!.time, "strictly ascending across 22 sessions");
  }
});

test("fetchVectorSeedBars: newest 3 sessions stay 1m; older sessions are decimated to 5m", async () => {
  const res = await fetchVectorSeedBars(
    "NVDA",
    new Date("2026-07-06T15:00:00Z"),
    async () => [],
    daysFetcher(390),
    async () => new Map()
  );
  assert.equal(res.sessionYmds.length, 22);
  // 3 × 390 (1m) + 19 × 78 (5m) = 2,652 bars.
  assert.equal(res.bars.length, 3 * 390 + 19 * 78);
  // The oldest session's bars step by 300s (5m); the latest session's step by 60s (1m).
  assert.equal(res.bars[1]!.time - res.bars[0]!.time, 300, "oldest session decimated to 5m");
  const last = res.bars.length - 1;
  assert.equal(res.bars[last]!.time - res.bars[last - 1]!.time, 60, "latest session native 1m");
});

test("fetchVectorSeedBars: targetSessions=3 reproduces the pre-multi-day seed exactly (all 1m)", async () => {
  const res = await fetchVectorSeedBars(
    "NVDA",
    new Date("2026-07-06T15:00:00Z"),
    async () => [],
    daysFetcher(390),
    async () => new Map(),
    3
  );
  assert.equal(res.sessionYmds.length, 3);
  assert.equal(res.bars.length, 3 * 390);
  // Every step is 1m within sessions — no decimation at ≤ FULL_RES_SESSIONS depth.
  assert.equal(res.bars[1]!.time - res.bars[0]!.time, 60);
});

test("fetchVectorSeedBars: bar-count ceiling drops whole OLDEST sessions, never the latest", async () => {
  // 3000 bars/session (pathological sub-minute-ish density): 3×3000 (1m) already busts the 7000
  // cap after the second prior session; the latest session must always survive.
  const res = await fetchVectorSeedBars(
    "NVDA",
    new Date("2026-07-06T15:00:00Z"),
    async () => [],
    daysFetcher(3000),
    async () => new Map()
  );
  assert.equal(res.sessionYmd, "2026-07-06");
  assert.ok(res.sessionYmds.includes("2026-07-06"), "latest session always included");
  assert.ok(res.bars.length <= 7000, `cap respected, got ${res.bars.length}`);
  assert.ok(res.sessionYmds.length >= 1 && res.sessionYmds.length < 22, "older sessions dropped");
});

test("fetchVectorSeedBars: no sessions anywhere → empty result with today's ymd and no session list", async () => {
  const res = await fetchVectorSeedBars(
    "SPX",
    new Date("2026-07-06T15:00:00Z"),
    async () => [],
    async () => [],
    async () => new Map()
  );
  assert.deepEqual(res.bars, []);
  assert.deepEqual(res.sessionYmds, []);
  assert.equal(res.latestSessionStartSec, null);
  assert.equal(res.sessionYmd, "2026-07-06");
});
