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
