import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeBreakerOpenUntil } from "./uw-rate-limiter";

// CIRCUIT_PAUSE_MS defaults to 45_000 -> BREAKER_MAX_FUTURE_MS = 135_000 (env unset in test).
const PAUSE = 45_000;
const MAX_FUTURE = PAUSE * 3;

test("peer in the past returns current unchanged", () => {
  const now = 1_000_000;
  assert.equal(mergeBreakerOpenUntil(now + 5_000, now - 10_000, now), now + 5_000);
});

test("peer exactly at now is treated as past (not future) -> unchanged", () => {
  const now = 1_000_000;
  assert.equal(mergeBreakerOpenUntil(now + 5_000, now, now), now + 5_000);
});

test("NaN peer returns current unchanged", () => {
  const now = 1_000_000;
  assert.equal(mergeBreakerOpenUntil(now + 5_000, NaN, now), now + 5_000);
});

test("Infinity peer returns current unchanged (non-finite guard)", () => {
  const now = 1_000_000;
  assert.equal(mergeBreakerOpenUntil(now + 5_000, Infinity, now), now + 5_000);
});

test("peer ahead of current extends to peer", () => {
  const now = 1_000_000;
  const peer = now + 10_000;
  assert.equal(mergeBreakerOpenUntil(now + 5_000, peer, now), peer);
});

test("peer below current returns current (Math.max, never shortens)", () => {
  const now = 1_000_000;
  const current = now + 20_000;
  assert.equal(mergeBreakerOpenUntil(current, now + 5_000, now), current);
});

test("idempotent: re-applying same accepted peer is a no-op", () => {
  const now = 1_000_000;
  const peer = now + 10_000;
  const once = mergeBreakerOpenUntil(now, peer, now);
  const twice = mergeBreakerOpenUntil(once, peer, now);
  assert.equal(once, peer);
  assert.equal(twice, once);
});

test("poison guard: far-future peer is clamped to now+BREAKER_MAX_FUTURE_MS", () => {
  const now = 1_000_000;
  const poison = now + PAUSE * 1_000;
  assert.equal(mergeBreakerOpenUntil(0, poison, now), now + MAX_FUTURE);
});

test("poison guard does not lower an already-larger current", () => {
  const now = 1_000_000;
  const current = now + MAX_FUTURE + 50_000;
  const poison = now + PAUSE * 1_000;
  assert.equal(mergeBreakerOpenUntil(current, poison, now), current);
});
