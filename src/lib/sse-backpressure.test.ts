import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sseBackpressureExceeded,
  resolveMaxQueuedChunks,
  SSE_DEFAULT_MAX_QUEUED_CHUNKS,
} from "./sse-backpressure";

// With the default count strategy (HWM=1) a healthy reading client keeps
// desiredSize >= 0 and never trips the <= -maxQueuedChunks guard.

test("healthy desiredSize never trips", () => {
  assert.equal(sseBackpressureExceeded(1, 64), false);
  assert.equal(sseBackpressureExceeded(0, 64), false);
});

test("under the bound is false, at/over the bound is true", () => {
  assert.equal(sseBackpressureExceeded(-63, 64), false);
  assert.equal(sseBackpressureExceeded(-64, 64), true);
  assert.equal(sseBackpressureExceeded(-100, 64), true);
});

test("null desiredSize (closed/errored) is false", () => {
  assert.equal(sseBackpressureExceeded(null, 64), false);
});

test("explicit max overrides", () => {
  assert.equal(sseBackpressureExceeded(-10, 8), true);
  assert.equal(sseBackpressureExceeded(-10, 32), false);
});

test("resolveMaxQueuedChunks parsing + fallback", () => {
  assert.equal(resolveMaxQueuedChunks(undefined), SSE_DEFAULT_MAX_QUEUED_CHUNKS);
  assert.equal(resolveMaxQueuedChunks("10"), 10);
  assert.equal(resolveMaxQueuedChunks("0"), SSE_DEFAULT_MAX_QUEUED_CHUNKS);
  assert.equal(resolveMaxQueuedChunks("-5"), SSE_DEFAULT_MAX_QUEUED_CHUNKS);
  assert.equal(resolveMaxQueuedChunks("abc"), SSE_DEFAULT_MAX_QUEUED_CHUNKS);
});
