import { test } from "node:test";
import assert from "node:assert/strict";
import { freshestMessageAt, isUwSocketStalled } from "./uw-socket-stall";

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

test("isUwSocketStalled: never delivered (null) -> false", () => {
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
