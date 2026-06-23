import { test } from "node:test";
import assert from "node:assert/strict";
import { isHaltStillActive, pruneExpiredHalts, type StoredTradingHalt } from "./trading-halts-expiry";

function halt(partial: Partial<StoredTradingHalt>): StoredTradingHalt {
  return {
    symbol: "SPY",
    halt_type: "T1",
    reason: null,
    halted_at: null,
    active: true,
    receivedAt: 1_000_000,
    ...partial,
  };
}

const MAX = 30 * 60_000;

test("active halt within maxAge is still active", () => {
  assert.equal(isHaltStillActive({ active: true, receivedAt: 1_000_000 }, 1_000_000 + MAX - 1, MAX), true);
});

test("missed-resume self-heals: active halt older than maxAge is not active", () => {
  assert.equal(isHaltStillActive({ active: true, receivedAt: 1_000_000 }, 1_000_000 + MAX + 1, MAX), false);
});

test("boundary now-receivedAt === maxAge stays active (<=)", () => {
  assert.equal(isHaltStillActive({ active: true, receivedAt: 1_000_000 }, 1_000_000 + MAX, MAX), true);
});

test("active:false is never active regardless of age", () => {
  assert.equal(isHaltStillActive({ active: false, receivedAt: 1_000_000 }, 1_000_000, MAX), false);
});

test("NaN/missing receivedAt is treated as expired", () => {
  assert.equal(isHaltStillActive({ active: true, receivedAt: NaN }, 1_000_000, MAX), false);
});

test("pruneExpiredHalts removes stale/inactive, keeps fresh active, returns count", () => {
  const now = 2_000_000;
  const m = new Map<string, StoredTradingHalt>([
    ["FRESH", halt({ symbol: "FRESH", receivedAt: now })],
    ["STALE", halt({ symbol: "STALE", receivedAt: now - MAX - 1 })],
    ["INACTIVE", halt({ symbol: "INACTIVE", active: false, receivedAt: now })],
  ]);
  const removed = pruneExpiredHalts(m, now, MAX);
  assert.equal(removed, 2);
  assert.equal(m.has("FRESH"), true);
  assert.equal(m.has("STALE"), false);
  assert.equal(m.has("INACTIVE"), false);
});

test("pruneExpiredHalts is a no-op on an empty map", () => {
  const m = new Map<string, StoredTradingHalt>();
  assert.equal(pruneExpiredHalts(m, 1_000_000, MAX), 0);
});
