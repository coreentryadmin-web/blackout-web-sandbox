/**
 * Pure helpers for the UW multiplex-socket stall watchdog. Alias-free so they
 * are unit-testable under `tsx --test` without resolving the @/ alias or pulling
 * in the live WebSocket manager.
 */

/** Stall window: OPEN socket with no delivery for this long is half-open. */
export const UW_SOCKET_STALL_MS = 75_000;

/**
 * Newest last-delivery timestamp across the supplied channels, or null when
 * none of them has ever delivered. `activeChannels` should be the channels that
 * currently have handlers — channels nobody listens to must not keep the socket
 * alive nor force a reconnect.
 */
export function freshestMessageAt(
  lastMessageAt: Partial<Record<string, number>>,
  activeChannels: readonly string[]
): number | null {
  let freshest: number | null = null;
  for (const ch of activeChannels) {
    const at = lastMessageAt[ch];
    if (typeof at === "number" && (freshest == null || at > freshest)) {
      freshest = at;
    }
  }
  return freshest;
}

/**
 * Whether an OPEN socket should be treated as stalled (half-open): it has
 * delivered at least once and the freshest delivery is older than `stallMs`.
 * Returns false when never delivered (freshest == null) so a freshly opened
 * socket is not torn down before first data.
 */
export function isUwSocketStalled(
  freshest: number | null,
  stallMs: number,
  now: number
): boolean {
  if (freshest == null) return false;
  return now - freshest > stallMs;
}

/** Merge local (this replica) and cluster (Redis leader heartbeat) delivery times. */
export function mergeFreshestTimestamps(local: number | null, cluster: number | null): number | null {
  if (local == null) return cluster;
  if (cluster == null) return local;
  return Math.max(local, cluster);
}
