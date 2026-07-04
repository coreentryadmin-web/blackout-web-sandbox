import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveZeroDteFreshness } from "./ZeroDteBoard";

test("resolveZeroDteFreshness: upstream_ok=false always reads offline, regardless of age", () => {
  assert.equal(resolveZeroDteFreshness(false, Date.now(), Date.now()), "offline");
  // Even a fresh as_of can't paper over a scan that couldn't see the tape this cycle.
  assert.equal(resolveZeroDteFreshness(false, 1000, 1000), "offline");
});

test("resolveZeroDteFreshness: fresh response with a healthy upstream reads live", () => {
  const now = 1_000_000;
  assert.equal(resolveZeroDteFreshness(true, now - 5_000, now), "live");
});

test("resolveZeroDteFreshness: response older than the stale threshold reads stale, not live", () => {
  // Regression: this is the exact bug the audit found -- ZeroDteBoard.tsx hardcoded
  // status="live" unconditionally, so a stuck feed (upstream healthy but as_of not
  // advancing) rendered identically to a genuinely current board.
  const now = 1_000_000;
  assert.equal(resolveZeroDteFreshness(true, now - 61_000, now), "stale");
  assert.equal(resolveZeroDteFreshness(true, now - 59_000, now), "live");
});

test("resolveZeroDteFreshness: missing as_of (0) never falsely reports stale", () => {
  assert.equal(resolveZeroDteFreshness(true, 0, 1_000_000), "live");
});

test("resolveZeroDteFreshness: respects a custom staleAfterMs threshold", () => {
  const now = 1_000_000;
  assert.equal(resolveZeroDteFreshness(true, now - 5_000, now, 3_000), "stale");
  assert.equal(resolveZeroDteFreshness(true, now - 2_000, now, 3_000), "live");
});
