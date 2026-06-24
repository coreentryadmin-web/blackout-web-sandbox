// Pure, alias-free GLOBAL daily Night's Watch narrative budget. No @/lib imports so it is
// unit-testable under `node --test` (mirrors largo-budget.ts / ai-spend.ts). The engine layer
// owns Redis I/O + fail-open; this module is just math + keys.
//
// SCALING: this budget is GLOBAL — the key has NO userId. Combined with the per-POSITION
// narrative cache (position-narrative.ts), 500 users opening the SAME contract's detail cost ONE
// Claude call, and this daily counter is the hard cluster-wide ceiling on narrative spend.

import { etDayKey } from "../ai-spend";

/** Default hard daily cap on distinct narrative GENERATIONS (cache misses) cluster-wide. */
export const NARRATIVE_DAILY_BUDGET = 500;

/** Read the env cap; falls back to the default for unset / non-numeric / <=0 values. */
export function narrativeDailyBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.NIGHTS_WATCH_NARRATIVE_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : NARRATIVE_DAILY_BUDGET;
}

/** Redis key for the GLOBAL daily narrative-generation count, namespaced by ET calendar day. */
export function narrativeBudgetKey(now: Date = new Date()): string {
  return `narrative:budget:${etDayKey(now)}`;
}

/** True when the cluster is AT/over the daily narrative cap and generation must be skipped. */
export function isOverNarrativeBudget(
  currentCount: number,
  cap: number = NARRATIVE_DAILY_BUDGET
): boolean {
  return currentCount >= cap;
}
