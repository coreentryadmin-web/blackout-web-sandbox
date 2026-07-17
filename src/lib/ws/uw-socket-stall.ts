/**
 * Pure helpers for the UW multiplex-socket stall watchdog. Alias-free so they
 * are unit-testable under `tsx --test` without resolving the @/ alias or pulling
 * in the live WebSocket manager.
 */

/** Stall window during RTH: OPEN socket with no delivery for this long is half-open. */
export const UW_SOCKET_STALL_MS = 75_000;

/** Off-hours stall window — price-only traffic is sparser AH, use a wider window. */
export const UW_SOCKET_STALL_OFFHOURS_MS = 5 * 60_000;

/**
 * Grace period for first message after connect. UW silently accepts duplicate
 * API-key connections but never sends data on them — after this many ms with
 * zero messages the socket is treated as dead so the stall watchdog tears it
 * down and reconnects (giving the leader lock a chance to cycle).
 */
export const UW_SOCKET_FIRST_MSG_GRACE_MS = 30_000;

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
 * Whether an OPEN socket should be treated as stalled.
 *
 * Two modes:
 * 1. Has delivered before: stalled if freshest delivery > `stallMs` ago.
 * 2. Never delivered (freshest == null): stalled if the socket has been open
 *    longer than `firstMsgGraceMs` — catches UW silently accepting a duplicate
 *    API-key connection and never sending data.
 */
export function isUwSocketStalled(
  freshest: number | null,
  stallMs: number,
  now: number,
  openedAt?: number | null,
  firstMsgGraceMs?: number
): boolean {
  if (freshest != null) return now - freshest > stallMs;
  if (openedAt != null && firstMsgGraceMs != null) {
    return now - openedAt > firstMsgGraceMs;
  }
  return false;
}

/** Merge local (this replica) and cluster (Redis leader heartbeat) delivery times. */
export function mergeFreshestTimestamps(local: number | null, cluster: number | null): number | null {
  if (local == null) return cluster;
  if (cluster == null) return local;
  return Math.max(local, cluster);
}
