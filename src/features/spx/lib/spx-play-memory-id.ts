/** Shared monotonic IDs for in-memory play rows (no DB). */
let nextPlayId = 1;

export function nextMemoryPlayId(): number {
  return nextPlayId++;
}

/** Test helper — reset counter between unit tests. */
export function resetMemoryPlayIds(): void {
  nextPlayId = 1;
}
