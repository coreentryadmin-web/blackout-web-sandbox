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

test("evaluateTradeGovernor: bypass_buy_cooldown skips post-exit cooldown (WATCH→ENTRY promote path)", () => {
  const recentExit = Date.now() - 60_000;
  const blocked = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: { vix: 16 },
    session: {
      last_buy_at: null,
      last_sell_at: recentExit,
      last_sell_was_loss: false,
      last_direction: "long",
      last_stop_at: null,
    },
  });
  assert.ok(blocked.blocks.some((b) => b.includes("Buy cooldown")));

  const bypassed = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: { vix: 16 },
    session: {
      last_buy_at: null,
      last_sell_at: recentExit,
      last_sell_was_loss: false,
      last_direction: "long",
      last_stop_at: null,
    },
    bypass_buy_cooldown: true,
  });
  assert.equal(
    bypassed.blocks.some((b) => b.includes("Buy cooldown")),
    false
  );
});
