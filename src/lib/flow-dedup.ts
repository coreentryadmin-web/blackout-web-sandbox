/**
 * Bounded in-process recent-key dedup for high-rate streams (e.g. UW flow_alerts).
 *
 * Pure + alias-free (no @/ imports) so it is unit-testable under `tsx --test`.
 * This is an OPTIMIZATION layer only: callers must key on an id that a durable
 * store (DB ON-CONFLICT) already treats as the uniqueness key, so a `seen()` hit
 * can only ever suppress what the durable layer would also reject as a duplicate.
 * It never decides correctness on its own.
 *
 * Memory is bounded two ways: a TTL window (keys older than `ttlMs` are ignored
 * and lazily evicted) and a hard `maxKeys` cap (oldest insertion evicted first).
 * Map iteration is avoided to stay safe at this tsconfig target — eviction reads
 * the first key via Array.from(map.keys())[0].
 */
export interface FlowDedup {
  /**
   * Records `key` as seen at `now` and returns whether it was ALREADY seen
   * within the TTL window. Unknown/expired keys return false (process them).
   */
  seen(key: string, now?: number): boolean;
  /** Current number of retained keys (test/inspection helper). */
  size(): number;
}

export function makeFlowDedup(opts?: { ttlMs?: number; maxKeys?: number }): FlowDedup {
  const ttlMs = opts?.ttlMs ?? 60_000;
  const maxKeys = opts?.maxKeys ?? 5_000;
  // Insertion-ordered: first key is the oldest. value = last-seen timestamp.
  const recent = new Map<string, number>();

  function evictOldest(): void {
    const oldest = Array.from(recent.keys())[0];
    if (oldest !== undefined) recent.delete(oldest);
  }

  return {
    seen(key: string, now: number = Date.now()): boolean {
      const prev = recent.get(key);
      if (prev !== undefined) {
        if (now - prev < ttlMs) {
          // Refresh recency: re-insert at the tail so a hot key is not evicted early.
          recent.delete(key);
          recent.set(key, now);
          return true;
        }
        // Expired: treat as new, fall through to re-insert.
        recent.delete(key);
      }
      recent.set(key, now);
      while (recent.size > maxKeys) evictOldest();
      return false;
    },
    size(): number {
      return recent.size;
    },
  };
}
