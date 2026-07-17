import { test } from "node:test";
import assert from "node:assert/strict";
import { freshestMessageAt, isUwSocketStalled, mergeFreshestTimestamps, UW_SOCKET_FIRST_MSG_GRACE_MS } from "./uw-socket-stall";

const CHANNELS = ["flow_alerts", "market_tide", "gex"] as const;

test("freshestMessageAt: empty map + channels -> null", () => {
  assert.equal(freshestMessageAt({}, CHANNELS), null);
});

test("freshestMessageAt: returns the max across active channels", () => {
  assert.equal(freshestMessageAt({ flow_alerts: 10, market_tide: 50, gex: 30 }, CHANNELS), 50);
});

test("freshestMessageAt: a ts on a channel NOT in the active set is ignored", () => {
  assert.equal(freshestMessageAt({ off_lit_trades: 9_999 }, CHANNELS), null);
  assert.equal(freshestMessageAt({ flow_alerts: 10, off_lit_trades: 9_999 }, CHANNELS), 10);
});

test("isUwSocketStalled: never delivered, no openedAt -> false (legacy compat)", () => {
  assert.equal(isUwSocketStalled(null, 75_000, 1_000_000), false);
});

test("isUwSocketStalled: within window -> false", () => {
  assert.equal(isUwSocketStalled(1_000_000 - 10_000, 75_000, 1_000_000), false);
});

test("isUwSocketStalled: beyond window -> true", () => {
  assert.equal(isUwSocketStalled(1_000_000 - 80_000, 75_000, 1_000_000), true);
});

test("isUwSocketStalled: boundary now-freshest === stallMs -> false (strict >)", () => {
  assert.equal(isUwSocketStalled(1_000_000 - 75_000, 75_000, 1_000_000), false);
});

// --- first-message grace period (silent-connection detection) ---

test("isUwSocketStalled: never delivered + openedAt within grace -> false", () => {
  const now = 1_000_000;
  const openedAt = now - 10_000; // 10s ago — within 30s grace
  assert.equal(isUwSocketStalled(null, 75_000, now, openedAt, UW_SOCKET_FIRST_MSG_GRACE_MS), false);
});

test("isUwSocketStalled: never delivered + openedAt past grace -> true (silent socket)", () => {
  const now = 1_000_000;
  const openedAt = now - 35_000; // 35s ago — past 30s grace
  assert.equal(isUwSocketStalled(null, 75_000, now, openedAt, UW_SOCKET_FIRST_MSG_GRACE_MS), true);
});

test("isUwSocketStalled: never delivered + openedAt at boundary -> false (strict >)", () => {
  const now = 1_000_000;
  const openedAt = now - UW_SOCKET_FIRST_MSG_GRACE_MS; // exactly at boundary
  assert.equal(isUwSocketStalled(null, 75_000, now, openedAt, UW_SOCKET_FIRST_MSG_GRACE_MS), false);
});

test("isUwSocketStalled: has delivered + openedAt has no effect (uses stallMs)", () => {
  const now = 1_000_000;
  const freshest = now - 10_000; // within stall window
  assert.equal(isUwSocketStalled(freshest, 75_000, now, now - 100_000, UW_SOCKET_FIRST_MSG_GRACE_MS), false);
});

test("UW_SOCKET_FIRST_MSG_GRACE_MS is 30_000", () => {
  assert.equal(UW_SOCKET_FIRST_MSG_GRACE_MS, 30_000);
});

test("mergeFreshestTimestamps: null handling + max", () => {
  assert.equal(mergeFreshestTimestamps(null, null), null);
  assert.equal(mergeFreshestTimestamps(10, null), 10);
  assert.equal(mergeFreshestTimestamps(null, 20), 20);
  assert.equal(mergeFreshestTimestamps(10, 20), 20);
});
