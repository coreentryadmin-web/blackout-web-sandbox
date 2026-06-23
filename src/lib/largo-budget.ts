// Pure, alias-free per-user DAILY Largo query-budget logic. No @/lib imports so it
// is unit-testable under `npx tsx --test` (mirrors ai-spend.ts / safe-time.ts).
// The route layer owns Redis I/O + fail-open; this module is just math + keys.

import { etDayKey } from "./ai-spend";

/** Default per-user daily Largo query cap when LARGO_DAILY_QUERY_BUDGET is unset/invalid. */
export const DEFAULT_LARGO_DAILY_QUERY_BUDGET = 100;

/** Read the env cap; falls back to the default for unset / non-numeric / <=0 values. */
export function largoDailyQueryBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.LARGO_DAILY_QUERY_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_LARGO_DAILY_QUERY_BUDGET;
}

/** Redis key for a user's daily query count, namespaced by ET calendar day. */
export function largoBudgetKey(userId: string, now: Date = new Date()): string {
  return `largo:budget:${userId}:${etDayKey(now)}`;
}

/**
 * Seconds from `now` until the next ET midnight, clamped to [60, 26h]. Used as the TTL
 * on the daily key so the counter auto-clears at the ET day boundary even if no later
 * request rewrites it. Computed by diffing the ET wall-clock H:M:S off `now`.
 */
export function secondsUntilEtMidnight(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const elapsed = get("hour") * 3600 + get("minute") * 60 + get("second");
  const remaining = 86_400 - elapsed;
  // Floor at 60s (never a sub-minute TTL near midnight); cap at 26h as a ceiling.
  return Math.min(Math.max(remaining, 60), 26 * 3600);
}

/** True when the user is AT/over the cap and a new query must be rejected. */
export function isOverLargoBudget(currentCount: number, cap: number): boolean {
  return currentCount >= cap;
}
