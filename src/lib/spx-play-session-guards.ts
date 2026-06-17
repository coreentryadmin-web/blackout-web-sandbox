/**
 * Independent session cutoffs — do not merge these checks:
 * - `isPastNoEntryCutoff` → flat path only (SCANNING / WATCH / BUY gates)
 * - `isPastForceExitCutoff` → open-play path only (HOLD / TRIM every poll)
 */
import {
  playForceExitEtHour,
  playForceExitEtMin,
  playNoEntryAfterEtHour,
  playNoEntryAfterEtMin,
} from "@/lib/spx-play-config";
import { etClock, etMinutes, formatEtTime } from "@/lib/spx-play-session-time";

export const CASH_OPEN_ET_MINS = etClock(9, 30);
export const PREMARKET_START_ET_MINS = etClock(7, 0);

function etWeekday(now: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

function isEtWeekday(now: Date): boolean {
  const d = etWeekday(now);
  return d >= 1 && d <= 5;
}

/** 7:00–10:30 AM ET weekdays — parallel lotto engine window. */
export function isLottoWindow(now = new Date()): boolean {
  if (!isEtWeekday(now)) return false;
  const etMins = etMinutes(now);
  return etMins >= PREMARKET_START_ET_MINS && etMins < etClock(10, 30);
}

/** 7:00 AM–4:00 PM ET weekdays — server cron evaluation window for play + lotto. */
export function isSpxEngineCronWindow(now = new Date()): boolean {
  if (!isEtWeekday(now)) return false;
  const etMins = etMinutes(now);
  return etMins >= PREMARKET_START_ET_MINS && etMins < etClock(16, 0);
}

/** 7:00–9:30 AM ET weekdays — desk tracks data; lotto playbook only (no BUY). */
export function isPremarketPlanningWindow(now = new Date()): boolean {
  if (!isEtWeekday(now)) return false;
  const etMins = etMinutes(now);
  return etMins >= PREMARKET_START_ET_MINS && etMins < CASH_OPEN_ET_MINS;
}

export function isBeforeCashOpen(now = new Date()): boolean {
  if (!isEtWeekday(now)) return true;
  return etMinutes(now) < CASH_OPEN_ET_MINS;
}

export function cashOpenLabel(): string {
  return formatEtTime(9, 30);
}

/** Block new entries (cold BUY + WATCH→ENTRY promote). Default 3:30 PM ET. */
export function isPastNoEntryCutoff(now = new Date()): boolean {
  return etMinutes(now) >= etClock(playNoEntryAfterEtHour(), playNoEntryAfterEtMin());
}

export function noEntryCutoffLabel(): string {
  return formatEtTime(playNoEntryAfterEtHour(), playNoEntryAfterEtMin());
}

/** Force-flatten open 0DTE runners. Default 3:50 PM ET. */
export function isPastForceExitCutoff(now = new Date()): boolean {
  return etMinutes(now) >= etClock(playForceExitEtHour(), playForceExitEtMin());
}

export function forceExitCutoffLabel(): string {
  return formatEtTime(playForceExitEtHour(), playForceExitEtMin());
}
