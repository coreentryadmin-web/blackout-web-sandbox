import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiSpendKey,
  AI_SPEND_KEY_PREFIX,
  aiSpendAlertThresholdUsd,
  DEFAULT_AI_SPEND_ALERT_USD,
  aiSpendKillSwitchUsd,
  spendThresholdJustCrossed,
  isOverAiSpendCeiling,
} from "./ai-spend-ledger";
import { etDayKey } from "./ai-spend";

// Pure unit tests for the cross-replica AI-spend ledger. Alias-free (imports only sibling
// ./ai-spend), runnable via `tsx --test` — no Redis, no Next boot.

// ---- aiSpendKey ----
test("key is blackout:ai:spend:{etDayKey}", () => {
  const now = new Date("2026-06-22T15:00:00Z"); // 11:00 ET, same calendar day
  assert.equal(aiSpendKey(now), `${AI_SPEND_KEY_PREFIX}${etDayKey(now)}`);
  assert.equal(aiSpendKey(now), "blackout:ai:spend:2026-06-22");
});

test("key buckets by ET, not UTC (rollover across ET midnight)", () => {
  const lateNightEt = new Date("2026-06-23T03:30:00Z"); // 23:30 ET on the 22nd
  const afterEtMidnight = new Date("2026-06-23T04:30:00Z"); // 00:30 ET on the 23rd
  assert.equal(aiSpendKey(lateNightEt), "blackout:ai:spend:2026-06-22");
  assert.equal(aiSpendKey(afterEtMidnight), "blackout:ai:spend:2026-06-23");
});

// ---- aiSpendAlertThresholdUsd ----
test("alert threshold: unset falls back to default 50", () => {
  assert.equal(aiSpendAlertThresholdUsd({} as NodeJS.ProcessEnv), 50);
  assert.equal(aiSpendAlertThresholdUsd({} as NodeJS.ProcessEnv), DEFAULT_AI_SPEND_ALERT_USD);
});

test("alert threshold: valid number parsed; zero/negative/non-numeric fall back", () => {
  assert.equal(aiSpendAlertThresholdUsd({ DAILY_AI_SPEND_ALERT_USD: "125" } as NodeJS.ProcessEnv), 125);
  assert.equal(aiSpendAlertThresholdUsd({ DAILY_AI_SPEND_ALERT_USD: "0" } as NodeJS.ProcessEnv), 50);
  assert.equal(aiSpendAlertThresholdUsd({ DAILY_AI_SPEND_ALERT_USD: "-5" } as NodeJS.ProcessEnv), 50);
  assert.equal(aiSpendAlertThresholdUsd({ DAILY_AI_SPEND_ALERT_USD: "abc" } as NodeJS.ProcessEnv), 50);
});

// ---- aiSpendKillSwitchUsd (opt-in: null disables) ----
test("kill-switch: unset/invalid returns null (disabled)", () => {
  assert.equal(aiSpendKillSwitchUsd({} as NodeJS.ProcessEnv), null);
  assert.equal(aiSpendKillSwitchUsd({ DAILY_AI_SPEND_KILL_USD: "0" } as NodeJS.ProcessEnv), null);
  assert.equal(aiSpendKillSwitchUsd({ DAILY_AI_SPEND_KILL_USD: "-1" } as NodeJS.ProcessEnv), null);
  assert.equal(aiSpendKillSwitchUsd({ DAILY_AI_SPEND_KILL_USD: "nope" } as NodeJS.ProcessEnv), null);
});

test("kill-switch: positive value armed", () => {
  assert.equal(aiSpendKillSwitchUsd({ DAILY_AI_SPEND_KILL_USD: "250" } as NodeJS.ProcessEnv), 250);
  assert.equal(aiSpendKillSwitchUsd({ DAILY_AI_SPEND_KILL_USD: "199.5" } as NodeJS.ProcessEnv), 199.5);
});

// ---- spendThresholdJustCrossed (cluster alert-once) ----
test("crossing fires only on the increment that moves below->at/above", () => {
  // total goes 48 -> 52 with added=4, threshold 50: just crossed
  assert.equal(spendThresholdJustCrossed(52, 4, 50), true);
  // next increment 52 -> 56: already above, not "just crossed"
  assert.equal(spendThresholdJustCrossed(56, 4, 50), false);
  // increment that lands exactly on threshold counts (>=)
  assert.equal(spendThresholdJustCrossed(50, 10, 50), true);
  // increment entirely below threshold: no cross
  assert.equal(spendThresholdJustCrossed(40, 10, 50), false);
});

test("crossing is false for non-positive added or threshold", () => {
  assert.equal(spendThresholdJustCrossed(100, 0, 50), false);
  assert.equal(spendThresholdJustCrossed(100, -5, 50), false);
  assert.equal(spendThresholdJustCrossed(100, 10, 0), false);
});

// ---- isOverAiSpendCeiling ----
test("over-ceiling: at/over true, below false; null ceiling never over", () => {
  assert.equal(isOverAiSpendCeiling(199, 200), false);
  assert.equal(isOverAiSpendCeiling(200, 200), true);
  assert.equal(isOverAiSpendCeiling(201, 200), true);
  assert.equal(isOverAiSpendCeiling(1e9, null), false); // disabled kill-switch
});
