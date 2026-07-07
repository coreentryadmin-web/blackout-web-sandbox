import { test } from "node:test";
import assert from "node:assert/strict";
import { darkPoolLevelsFromSnapshot, spxStrikeFromDarkPoolPrint } from "./vector-dark-pool-levels";

test("spxStrikeFromDarkPoolPrint: SPY hundreds → SPX thousands", () => {
  assert.equal(spxStrikeFromDarkPoolPrint(543), 5430);
  assert.equal(spxStrikeFromDarkPoolPrint(7550), 7550);
});

test("darkPoolLevelsFromSnapshot: ranks strikes by premium share", () => {
  const levels = darkPoolLevelsFromSnapshot({
    prints: [
      { strike: 543, premium: 2_000_000, side: "buy", executed_at: "2026-07-07T10:00:00" },
      { strike: 545, premium: 1_000_000, side: "sell", executed_at: "2026-07-07T10:05:00" },
    ],
    total_premium: 3_000_000,
    call_premium: 0,
    put_premium: 0,
    bias: "mixed",
    pcr: null,
    detail: "test",
  });
  assert.equal(levels.length, 2);
  assert.equal(levels[0].strike, 5430);
  assert.ok(Math.abs(levels[0].pct - 66.67) < 0.1);
});
