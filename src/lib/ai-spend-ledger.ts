// Pure, alias-free CROSS-REPLICA daily Anthropic spend ledger. No @/lib imports so it
// is unit-testable under `tsx --test` (mirrors largo-budget.ts / ai-spend.ts). The
// provider/route layer owns Redis I/O + fail-open; this module is just keys, env
// parsing, the atomic Lua script, and the threshold/ceiling predicates.
//
// WHY this exists: the per-process SpendTracker (ai-spend.ts) only ever sees ONE
// replica's slice of spend, so under N Railway replicas its alert fires at ~threshold/N
// of true org spend and the real org-wide total is never observed (caveat documented
// in ai-spend.ts:6-9). This ledger lives in SHARED Redis — every replica INCRBYFLOATs
// one authoritative per-ET-day key — so the org total is exact and the single increment
// that crosses the threshold is the one org-wide alert.

import { etDayKey } from "./ai-spend";
import { secondsUntilEtMidnight } from "./largo-budget";

export const AI_SPEND_KEY_PREFIX = "blackout:ai:spend:";

/** Redis key for the GLOBAL daily Anthropic spend in USD, namespaced by ET calendar day. */
export function aiSpendKey(now: Date = new Date()): string {
  return `${AI_SPEND_KEY_PREFIX}${etDayKey(now)}`;
}

/** Default USD alert threshold when DAILY_AI_SPEND_ALERT_USD is unset/invalid. Mirrors the
 *  per-process tracker default (ai-spend.ts) so the threshold is one number, not two. */
export const DEFAULT_AI_SPEND_ALERT_USD = 50;

/** Read the alert threshold; falls back to the default for unset / non-numeric / <=0 values. */
export function aiSpendAlertThresholdUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.DAILY_AI_SPEND_ALERT_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AI_SPEND_ALERT_USD;
}

/**
 * Org-wide HARD kill-switch ceiling in USD. OPT-IN by design: unset / non-numeric / <=0
 * returns null, which DISABLES the kill-switch (callers MUST treat null as "no ceiling").
 *
 * Disabled-by-default is deliberate. A baked-in default ceiling could reject ALL premium
 * Largo traffic the instant this ships if real daily spend already sits above it — turning
 * a cost guardrail into a self-inflicted outage. The operator arms it explicitly once they
 * know their normal daily spend (recommended: a few × DAILY_AI_SPEND_ALERT_USD).
 */
export function aiSpendKillSwitchUsd(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = Number(env.DAILY_AI_SPEND_KILL_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Atomic accumulate: INCRBYFLOAT + EXPIRE in one round-trip so a crash between the two can
 * never leave the daily key without a TTL (a TTL-less key would carry spend across ET days
 * forever). Returns the post-incr running total as INCRBYFLOAT's native bulk-string reply.
 */
export const AI_SPEND_INCR_LUA =
  "local v = redis.call('INCRBYFLOAT', KEYS[1], ARGV[1]); redis.call('EXPIRE', KEYS[1], ARGV[2]); return v";

/**
 * True EXACTLY ONCE across the whole cluster: when the increment that produced `newTotal`
 * moved the org total from below `threshold` to at/above it. Because INCRBYFLOAT is atomic
 * and serialized by Redis's single thread, exactly one increment can satisfy this — giving
 * alert-once semantics with no stored "alerted" flag. `before` is reconstructed as
 * newTotal - added (the value Redis held immediately before this increment).
 */
export function spendThresholdJustCrossed(
  newTotal: number,
  added: number,
  threshold: number
): boolean {
  if (!(threshold > 0) || !(added > 0)) return false;
  const before = newTotal - added;
  return before < threshold && newTotal >= threshold;
}

/** True when the org is AT/over the hard daily ceiling and new spend-incurring work must be
 *  rejected. A null ceiling (kill-switch disabled) is never over. */
export function isOverAiSpendCeiling(currentTotal: number, ceiling: number | null): boolean {
  return ceiling != null && currentTotal >= ceiling;
}

// Re-exported so the provider layer can import the TTL helper from this one cohesive module
// alongside the key/Lua/threshold helpers, rather than reaching into largo-budget directly.
export { secondsUntilEtMidnight };
