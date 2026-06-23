import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePolyBreakerOpenUntil } from "./polygon-breaker-merge";

// POLY_CIRCUIT_PAUSE_MS = 60_000 -> MAX_FUTURE = 180_000. Helper has no default,
// so maxFutureMs is passed explicitly (matches the caller).
const PAUSE = 60_000;
const MAX_FUTURE = PAUSE * 3;

test("peer in the past returns current unchanged", () => {
  const now = 1_000_000;
  assert.equal(mergePolyBreakerOpenUntil(now + 5_000, now - 10_000, now, MAX_FUTURE), now + 5_000);
});

test("peer exactly at now treated as past -> unchanged", () => {
  const now = 1_000_000;
  assert.equal(mergePolyBreakerOpenUntil(now + 5_000, now, now, MAX_FUTURE), now + 5_000);
});

test("NaN peer returns current unchanged", () => {
  const now = 1_000_000;
  assert.equal(mergePolyBreakerOpenUntil(now + 5_000, NaN, now, MAX_FUTURE), now + 5_000);
});

test("Infinity peer returns current unchanged", () => {
  const now = 1_000_000;
  assert.equal(mergePolyBreakerOpenUntil(now + 5_000, Infinity, now, MAX_FUTURE), now + 5_000);
});

test("peer ahead of current extends to peer", () => {
  const now = 1_000_000;
  const peer = now + 10_000;
  assert.equal(mergePolyBreakerOpenUntil(now + 5_000, peer, now, MAX_FUTURE), peer);
});

test("peer below current returns current (never shortens)", () => {
  const now = 1_000_000;
  const current = now + 20_000;
  assert.equal(mergePolyBreakerOpenUntil(current, now + 5_000, now, MAX_FUTURE), current);
});

test("idempotent: re-applying accepted peer is a no-op", () => {
  const now = 1_000_000;
  const peer = now + 10_000;
  const once = mergePolyBreakerOpenUntil(now, peer, now, MAX_FUTURE);
  assert.equal(once, peer);
  assert.equal(mergePolyBreakerOpenUntil(once, peer, now, MAX_FUTURE), once);
});

test("poison guard clamps far-future peer to now+MAX_FUTURE", () => {
  const now = 1_000_000;
  const poison = now + PAUSE * 1_000;
  assert.equal(mergePolyBreakerOpenUntil(0, poison, now, MAX_FUTURE), now + MAX_FUTURE);
});

test("poison guard does not lower an already-larger current", () => {
  const now = 1_000_000;
  const current = now + MAX_FUTURE + 50_000;
  const poison = now + PAUSE * 1_000;
  assert.equal(mergePolyBreakerOpenUntil(current, poison, now, MAX_FUTURE), current);
});
