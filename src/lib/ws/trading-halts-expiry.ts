/**
 * Pure, alias-free helpers for expiring stale trading halts.
 *
 * A halt is normally cleared by a resume event (active:false). That event can be
 * dropped on the wire or missed across a WebSocket reconnect — without an expiry
 * the symbol would stay "halted" and block entries forever. These helpers add a
 * receivedAt-based ceiling so a missed resume self-heals after `maxAgeMs`.
 *
 * Kept dependency-free so it is unit-testable under `tsx --test` without the @/
 * path alias or any runtime imports.
 */

/** Stored halt: a normalized halt event plus the time it was received. */
export type StoredTradingHalt = {
  symbol: string;
  halt_type: string;
  reason: string | null;
  halted_at: string | null;
  active: boolean;
  /** Epoch ms when this active halt was last written to the store. */
  receivedAt: number;
};

/**
 * True only when the halt is active AND was received within `maxAgeMs` of `now`.
 * A non-finite/missing receivedAt is treated as expired (fail to "not active").
 */
export function isHaltStillActive(
  halt: Pick<StoredTradingHalt, "active" | "receivedAt">,
  now: number,
  maxAgeMs: number
): boolean {
  if (!halt.active) return false;
  if (!Number.isFinite(halt.receivedAt)) return false;
  return now - halt.receivedAt <= maxAgeMs;
}

/**
 * Delete any entry that is inactive or older than `maxAgeMs` from the map,
 * in place. Returns the number of entries removed. Safe on an empty map.
 */
export function pruneExpiredHalts(
  halts: Map<string, StoredTradingHalt>,
  now: number,
  maxAgeMs: number
): number {
  let removed = 0;
  for (const key of Array.from(halts.keys())) {
    const halt = halts.get(key);
    if (!halt || !isHaltStillActive(halt, now, maxAgeMs)) {
      halts.delete(key);
      removed += 1;
    }
  }
  return removed;
}
