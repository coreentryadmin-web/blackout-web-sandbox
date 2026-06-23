/**
 * Pure, alias-free helpers for WebSocket feed staleness alerting. Kept free of
 * the @/ alias and the live socket modules so they are unit-testable under
 * `tsx --test`. Observability only — these never touch socket behavior.
 */

/**
 * Freshest (smallest) age across a set of per-symbol ages in ms. Symbols that
 * have never delivered (age == null) are ignored. Returns null when no symbol
 * has ever delivered — callers treat "never delivered" separately from "stale".
 *
 * A feed is considered alive as long as ANY symbol is fresh, so the freshest
 * (minimum) age is the correct liveness signal for the whole socket.
 */
export function freshestFeedAgeMs(ages: ReadonlyArray<number | null | undefined>): number | null {
  let freshest: number | null = null;
  for (const age of ages) {
    if (typeof age === "number" && Number.isFinite(age)) {
      if (freshest == null || age < freshest) freshest = age;
    }
  }
  return freshest;
}

export type FeedStaleness = "fresh" | "stale" | "critical" | "never";

/**
 * Classify a feed's freshest age against warning/critical thresholds.
 * - "never"    -> no symbol has ever delivered (freshest == null)
 * - "critical" -> freshest age > criticalMs
 * - "stale"    -> freshest age > warnMs (but <= criticalMs)
 * - "fresh"    -> within warnMs
 *
 * Strict `>` so a boundary age equal to a threshold is the lower severity.
 */
export function classifyFeedStaleness(
  freshestAgeMs: number | null,
  warnMs: number,
  criticalMs: number
): FeedStaleness {
  if (freshestAgeMs == null) return "never";
  if (freshestAgeMs > criticalMs) return "critical";
  if (freshestAgeMs > warnMs) return "stale";
  return "fresh";
}
