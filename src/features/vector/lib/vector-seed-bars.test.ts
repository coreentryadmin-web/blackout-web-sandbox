import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchVectorSeedBars } from "./vector-seed-bars";

test("fetchVectorSeedBars: merges SPY volume onto SPX bars by time", async () => {
  const bars = await fetchVectorSeedBars(
    new Date("2026-07-06T15:00:00Z"),
    async (sym, from) => {
      if (from !== "2026-07-06") return [];
      if (sym === "I:SPX") {
        return [{ t: 1783368180000, o: 7500, h: 7510, l: 7490, c: 7505 }];
      }
      return [];
    },
    async () => new Map([[Math.floor(1783368180000 / 1000), 42000]])
  );
  assert.equal(bars.bars[0]?.volume, 42000);
});

test("fetchVectorSeedBars: uses today when bars exist", async () => {
  const bars = await fetchVectorSeedBars(new Date("2026-07-06T15:00:00Z"), async (sym, from) => {
    if (from === "2026-07-06" && sym === "I:SPX") {
      return [{ t: 1783368180000, o: 7500, h: 7510, l: 7490, c: 7505 }];
    }
    return [];
  });
  assert.equal(bars.sessionYmd, "2026-07-06");
  assert.equal(bars.bars.length, 1);
  assert.equal(bars.bars[0]?.close, 7505);
});

test("fetchVectorSeedBars: falls back to prior trading day when today is empty", async () => {
  const calls: string[] = [];
  const bars = await fetchVectorSeedBars(
    new Date("2026-07-07T05:00:00Z"),
    async (sym, from) => {
      calls.push(`${sym}:${from}`);
      if (from === "2026-07-06" && sym === "I:SPX") {
        return [{ t: 1783368180000, o: 7530, h: 7540, l: 7520, c: 7537.43 }];
      }
      return [];
    },
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
