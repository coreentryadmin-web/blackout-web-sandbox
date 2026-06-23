// Pure, alias-free SSE backpressure predicate. No DOM/runtime deps so it is unit-testable
// under tsx --test / node:test.
//
// A ReadableStreamDefaultController exposes desiredSize = highWaterMark - queueTotalSize.
// With the default count-based queuing strategy the high-water mark is 1, so:
//   - a healthy client that keeps reading keeps desiredSize >= 0 (queue drains),
//   - a slow/stalled client lets the queue grow and desiredSize goes increasingly negative.
//
// We treat a desiredSize at or below -MAX_QUEUED_CHUNKS as "this client is too far behind";
// the caller then closes that one connection instead of buffering unbounded in the controller.
// Default 64 chunks of slack tolerates normal bursts/heartbeats without ever tripping for a
// healthy consumer. Override per-instance via SSE_MAX_QUEUED_CHUNKS.

export const SSE_DEFAULT_MAX_QUEUED_CHUNKS = 64;

export function resolveMaxQueuedChunks(
  raw: string | undefined,
  fallback = SSE_DEFAULT_MAX_QUEUED_CHUNKS,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Decide whether a slow SSE consumer's un-drained backlog has grown past the bound.
 * @param desiredSize controller.desiredSize (highWaterMark - queueTotalSize), may be null.
 * @param maxQueuedChunks max chunks allowed to sit un-drained before we drop the client.
 * @returns true if the caller should close this connection instead of enqueueing more.
 */
export function sseBackpressureExceeded(
  desiredSize: number | null,
  maxQueuedChunks: number = resolveMaxQueuedChunks(process.env.SSE_MAX_QUEUED_CHUNKS),
): boolean {
  // null => stream is closed/errored; let the normal enqueue path handle teardown.
  if (desiredSize == null) return false;
  // queued chunks beyond the high-water mark = -desiredSize (when negative).
  return desiredSize <= -maxQueuedChunks;
}
