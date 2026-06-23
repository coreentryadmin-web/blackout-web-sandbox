/**
 * Pure, alias-free helpers for resolving the ET minute-of-day window that a macro
 * release should hard-block. Kept dependency-free (only string/number math) so it is
 * unit-testable via `tsx --test` without booting Next/server.
 *
 * Money-path note: these helpers only WIDEN protection when a release time is unknown.
 * A date-only macro row carries no clock time, so we must not assert a precise 8:30
 * window (that would leave a later real release — e.g. a 10:00 ET print — unguarded).
 * Instead we mark it imprecise and block the full morning.
 */

/** Parsed macro release time. `precise` is false when only a calendar date was given
 *  (the real clock time is unknown) — callers must widen the blocked window in that case. */
export type MacroEventTime = { minutes: number; precise: boolean };

/**
 * Parse a macro event `time` field into an ET minute-of-day plus a precision flag.
 *  - "HH:MM"      → { minutes, precise: true }
 *  - "YYYY-MM-DD" → only when it equals todayYmd: { minutes: 8*60+30, precise: false }
 *                   (8:30 is a placeholder anchor; precise=false tells callers it is unknown)
 *  - anything else / a non-today date → null (skip)
 */
export function parseMacroEventTime(timeRaw: string, todayYmd: string): MacroEventTime | null {
  const time = timeRaw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(time)) {
    if (time !== todayYmd) return null;
    // Date-only: real release time unknown. Anchor at 8:30 but flag imprecise so the
    // caller blocks the whole morning rather than a narrow 8:30 window.
    return { minutes: 8 * 60 + 30, precise: false };
  }
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { minutes: h * 60 + m, precise: true };
}

/** Inclusive ET minute-of-day window [start, end] to hard-block for a non-Fed macro release.
 *  Precise releases get the tight [t-5, t+60] window; imprecise (date-only) releases get the
 *  full morning [8:25, 12:00] so a later-than-8:30 print is never left unguarded. */
export function macroBlockWindow(ev: MacroEventTime): { start: number; end: number } {
  if (ev.precise) {
    return { start: ev.minutes - 5, end: ev.minutes + 60 };
  }
  return { start: 8 * 60 + 25, end: 12 * 60 };
}
