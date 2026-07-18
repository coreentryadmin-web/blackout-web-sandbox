// Pure, alias-free CROSS-REPLICA daily Anthropic spend ledger. No @/lib imports so it
// is unit-testable under `tsx --test` (mirrors largo-budget.ts / ai-spend.ts). The
// provider/route layer owns Redis I/O + fail-open; this module is just keys, env
// parsing, the atomic Lua script, and the threshold/ceiling predicates.
//
// WHY this exists: the per-process SpendTracker (ai-spend.ts) only ever sees ONE
// replica's slice of spend, so under N ECS replicas its alert fires at ~threshold/N
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
export const AI_SPEND_HEADROOM_LUA = `
local ceiling = tonumber(ARGV[1])
if ceiling == nil then return 1 end
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= ceiling then return 0 end
return 1
`;

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

/**
 * Conservative PER-PROCESS fraction of the org ceiling used as a fail-CLOSED backstop when the
 * shared cross-replica ledger is unreachable (Redis down). The kill-switch exists precisely to bound
 * a runaway Claude loop, and an infra blip is exactly when an unbounded loop is most dangerous — so a
 * Redis loss must NOT silently lift the ceiling. When Redis is down we can no longer see org-wide
 * spend, so each process self-limits to this slice of the ceiling: enough headroom that healthy
 * single-call traffic is never blocked, but low enough that a single looping process is stopped long
 * before it can burn the whole org budget. Override via DAILY_AI_SPEND_LOCAL_BACKSTOP_FRAC.
 */
export const DEFAULT_AI_SPEND_LOCAL_BACKSTOP_FRAC = 0.5;

/** Read the local-backstop fraction (0..1); falls back to the default for unset/invalid/out-of-range. */
export function aiSpendLocalBackstopFrac(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.DAILY_AI_SPEND_LOCAL_BACKSTOP_FRAC);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_AI_SPEND_LOCAL_BACKSTOP_FRAC;
}

/**
 * FAIL-CLOSED local backstop for the cost gate when the shared ledger can't be read.
 *
 * Returns true (→ reject new spend) when the kill-switch is ARMED (ceiling != null) AND this
 * process's own daily spend has already reached its conservative slice (frac × ceiling) of the
 * ceiling. With the kill-switch disarmed (ceiling == null) it always returns false, so this is a
 * no-op unless the operator has opted in — same OPT-IN contract as the live Redis ceiling. This is
 * the deliberate fail-CLOSED replacement for the old "Redis down → allow" no-op (audit S-5/#5/#6).
 */
export function isOverAiSpendLocalBackstop(
  localProcessTotal: number,
  ceiling: number | null,
  frac: number = DEFAULT_AI_SPEND_LOCAL_BACKSTOP_FRAC
): boolean {
  if (ceiling == null) return false; // kill-switch disarmed → never blocks (OPT-IN)
  const budget = ceiling * (frac > 0 && frac <= 1 ? frac : DEFAULT_AI_SPEND_LOCAL_BACKSTOP_FRAC);
  return localProcessTotal >= budget;
}

// Re-exported so the provider layer can import the TTL helper from this one cohesive module
// alongside the key/Lua/threshold helpers, rather than reaching into largo-budget directly.
export { secondsUntilEtMidnight };
