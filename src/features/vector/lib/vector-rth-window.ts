/**
 * Regular-trading-hours (RTH) window helpers for SESSION-ANCHORED technicals — pure, epoch-seconds
 * in America/New_York. Dependency-free so the level math + VWAP stay unit-testable.
 *
 * WHY THIS EXISTS (P1-A, live-sweep 2026-07-14): equity/ETF minute feeds include PRE-MARKET
 * (from 04:00 ET) and after-hours bars, but session-anchored levels must anchor to the 09:30 RTH
 * open. Grouping only by ET CALENDAR DAY (etDayOfBarSec) made Opening Range / session HOD-LOD /
 * session VWAP start at the 04:00 premarket bar — rendering e.g. TSLA OR-H 395.60 vs the true-RTH
 * 400.82 (−5.2 pt), NVDA 205.30 vs 208.34, SPY 748.99 vs 751.52. SPX (a cash index) has NO
 * premarket bars, so it was correct by accident; gating to RTH fixes every equity/ETF while leaving
 * SPX unchanged (all its bars already fall inside the window).
 */

/** Cash-session RTH bounds in minutes since ET midnight. Half-open at the close so an after-hours
 *  bar stamped exactly 16:00 (bar covering 16:00–16:01) is excluded, while the 15:59 close bar is
 *  kept. NOTE: NYSE early-close (13:00) half-days are not special-cased here — those are rare and a
 *  13:30 after-hours bar slipping in only widens HOD/LOD by a hair; the 09:30 OPEN anchor (the P1-A
 *  bug) is exact regardless. */
export const RTH_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
export const RTH_CLOSE_MIN = 16 * 60; // 16:00 ET

const ET_HM = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Minutes since ET midnight for an epoch-seconds timestamp. Returns NaN for a non-finite input. */
export function etMinutesOfDaySec(sec: number): number {
  if (!Number.isFinite(sec)) return NaN;
  const parts = ET_HM.formatToParts(new Date(sec * 1000));
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = Number(p.value);
    else if (p.type === "minute") m = Number(p.value);
  }
  if (h === 24) h = 0; // some ICU builds render midnight as "24" under hour12:false
  return h * 60 + m;
}

/** True when an epoch-seconds bar falls inside the cash RTH window [09:30, 16:00) ET. */
export function isRthBarSec(sec: number): boolean {
  const mins = etMinutesOfDaySec(sec);
  return Number.isFinite(mins) && mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN;
}
