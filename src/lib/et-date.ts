// Single source of truth for the ET session-calendar-date string (YYYY-MM-DD).
//
// Pure + alias-free + no "server-only": importable from server engines/stores
// AND from client modules, and directly unit-testable under `tsx --test`.
//
// MONEY-PATH INVARIANT: this MUST stay byte-identical in behavior to the ~7
// copies it replaces (spx-play/lotto/power-hour stores+engines, spx-play-claude,
// admin-spx-dashboard). Do NOT add year/month/day option fields or change the
// locale/timeZone — 'en-CA' yields ISO-ordered YYYY-MM-DD and the tz boundary
// is what every session-date comparison depends on. Changing any of these would
// shift the daily session-reset boundary and corrupt lock/settle/sizing state.

const ET_TIME_ZONE = "America/New_York";

/**
 * The current calendar date in US/Eastern as "YYYY-MM-DD".
 * @param now injectable clock for deterministic tests; defaults to new Date()
 *            so the zero-arg call path is byte-identical to the originals.
 */
export function todayEt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET_TIME_ZONE }).format(now);
}
