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

/**
 * NYSE/CBOE standard early-close days (market closes at 1:00 PM ET).
 * Update annually: Black Friday (day after Thanksgiving) and Christmas Eve.
 * When July 4 falls on a weekday the market is fully closed (not an early close).
 */
const EARLY_CLOSE_DATES: Record<string, number> = {
  // Black Friday
  "2025-11-28": etClock(13, 0),
  "2026-11-27": etClock(13, 0),
  "2027-11-26": etClock(13, 0),
  // Christmas Eve
  "2025-12-24": etClock(13, 0),
  "2026-12-24": etClock(13, 0),
  "2027-12-24": etClock(13, 0),
};

function todayEtYmd(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** Returns the ET-minutes of the early close for today, or null if it's a normal session. */
function getEarlyCloseMinutes(now: Date): number | null {
  const envOverride = process.env.SPX_EARLY_CLOSE_ET_MINS;
  if (envOverride) return Number(envOverride);
  return EARLY_CLOSE_DATES[todayEtYmd(now)] ?? null;
}

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

/** Block new entries (cold BUY + WATCH→ENTRY promote). Default 3:30 PM ET.
 *  On early-close days, no-entry cutoff moves to 30 min before the early close.
 */
export function isPastNoEntryCutoff(now = new Date()): boolean {
  const earlyClose = getEarlyCloseMinutes(now);
  const cutoffMins = earlyClose != null
    ? earlyClose - 30
    : etClock(playNoEntryAfterEtHour(), playNoEntryAfterEtMin());
  return etMinutes(now) >= cutoffMins;
}

export function noEntryCutoffLabel(): string {
  return formatEtTime(playNoEntryAfterEtHour(), playNoEntryAfterEtMin());
}

/** Force-flatten open 0DTE runners. Default 3:50 PM ET.
 *  On early-close days (Black Friday, Christmas Eve) the cutoff is 10 min before
 *  the early close (e.g. 12:50 PM on a 1:00 PM close day) to avoid holding options
 *  that are already worthless after market close.
 */
export function isPastForceExitCutoff(now = new Date()): boolean {
  const earlyClose = getEarlyCloseMinutes(now);
  const cutoffMins = earlyClose != null
    ? earlyClose - 10  // 10 min before early close
    : etClock(playForceExitEtHour(), playForceExitEtMin());
  return etMinutes(now) >= cutoffMins;
}

/** Returns the force-exit time label for the current session (early-close aware). */
export function earlyCloseLabel(now = new Date()): string | null {
  const earlyClose = getEarlyCloseMinutes(now);
  if (!earlyClose) return null;
  const hours = Math.floor(earlyClose / 60);
  const mins = earlyClose % 60;
  return formatEtTime(hours, mins);
}

export function forceExitCutoffLabel(): string {
  return formatEtTime(playForceExitEtHour(), playForceExitEtMin());
}
