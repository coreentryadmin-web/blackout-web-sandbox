import { test } from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import { selectTopPrints } from "./helix-top-prints";

function row(partial: Partial<FlowAlert> & Pick<FlowAlert, "ticker">): FlowAlert {
  return {
    premium: 500_000,
    option_type: "CALL",
    strike: 100,
    expiry: "2026-07-20",
    alerted_at: "2026-07-17T15:00:00.000Z",
    score: 0,
    direction: "bullish",
    route: "stock",
    ...partial,
  } as FlowAlert;
}

test("selectTopPrints prefers score >= 5 when available", () => {
  const { rows, mode } = selectTopPrints([
    row({ ticker: "SPY", score: 8, premium: 1_000_000 }),
    row({ ticker: "QQQ", score: 3, premium: 5_000_000 }),
  ]);
  assert.equal(mode, "score");
  assert.equal(rows[0]?.ticker, "SPY");
});

test("selectTopPrints falls back to premium when no high scores", () => {
  const { rows, mode } = selectTopPrints([
    row({ ticker: "SPY", score: 2, premium: 2_000_000 }),
    row({ ticker: "QQQ", score: 1, premium: 5_000_000 }),
  ]);
  assert.equal(mode, "premium");
  assert.equal(rows[0]?.ticker, "QQQ");
});
