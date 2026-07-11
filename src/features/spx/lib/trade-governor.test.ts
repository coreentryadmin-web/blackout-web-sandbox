import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTradeGovernor } from "./trade-governor";

test("evaluateTradeGovernor: session loss cap halts entries", () => {
  const result = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: { vix: 16 },
    session: { session_losses_today: 3, last_buy_at: null, last_sell_at: null, last_sell_was_loss: false, last_direction: null, last_stop_at: null },
  });
  assert.ok(result.blocks.some((b) => b.includes("loss cap")));
  assert.equal(result.emergency_shutdown, true);
});

test("evaluateTradeGovernor: spread widening blocks", () => {
  const result = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-03",
    direction: "long",
    desk: { vix: 16 },
    session: { last_buy_at: null, last_sell_at: null, last_sell_was_loss: false, last_direction: null, last_stop_at: null },
    option: { mid: 3, spread_pct: 22, blocked: false, block_reason: null },
  });
  assert.ok(result.blocks.some((b) => b.includes("Spread")));
});
