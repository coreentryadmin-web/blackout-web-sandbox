// PR-L4d-2 — staleness marker for "right now"/live desk & Vector briefs.
//
// The desk / Vector string briefs render a live "right now" read from a CAPTURED snapshot. Off-hours
// (or when the warming cron has stalled) that snapshot reflects the PRIOR CLOSE, yet the brief prose
// still reads as fresh — the exact honesty gap the gauntlet caught. This computes a compact
// "· as of HH:MM ET[, prior close]" marker from the data's OWN as-of timestamp, and ONLY when the
// read is genuinely stale: outside regular trading hours (weekend / before 09:30 / at-or-after 16:00
// ET) or older than a freshness threshold. During RTH with fresh data it returns null — no marker.
//
// Pure + deterministic (the `now` clock is injectable) so it is unit-tested directly without touching
// the live composers. The ET wall-clock is derived from the capture instant via the Intl timezone
// database, the same technique spx-session-phase.ts uses.

/** A live read older than this is delayed, not "right now". 15 min tolerates normal cron cadence. */
const STALE_AGE_MS = 15 * 60 * 1000;
const RTH_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const RTH_CLOSE_MIN = 16 * 60; // 16:00 ET

/** The ET wall-clock (day-of-week + minutes-since-midnight) of an instant. */
function etWallClock(ms: number): { day: number; mins: number; hh: string; mm: string } {
  const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return {
    day: et.getDay(), // 0 = Sun … 6 = Sat
    mins: et.getHours() * 60 + et.getMinutes(),
    hh: String(et.getHours()).padStart(2, "0"),
    mm: String(et.getMinutes()).padStart(2, "0"),
  };
}

/**
 * A compact staleness marker for a live brief, or null when the read is genuinely fresh.
 *
 * @param asOf  the data's own capture/as-of timestamp (ISO). Null/unparseable → null (never fabricate
 *              a marker we can't source).
 * @param now   the current clock (injectable for tests); defaults to Date.now().
 * @returns e.g. "· as of 20:10 ET, prior close" off-hours, "· as of 11:40 ET, delayed" for an
 *          RTH-but-stale read, or null during RTH with fresh data.
 */
export function stalenessMarker(asOf: string | null | undefined, now: number = Date.now()): string | null {
  if (!asOf) return null;
  const asOfMs = new Date(asOf).getTime();
  if (!Number.isFinite(asOfMs)) return null;

  const { day, mins, hh, mm } = etWallClock(asOfMs);
  const isWeekend = day === 0 || day === 6;
  const isOffHours = isWeekend || mins < RTH_OPEN_MIN || mins >= RTH_CLOSE_MIN;
  const isStaleByAge = now - asOfMs > STALE_AGE_MS;

  if (!isOffHours && !isStaleByAge) return null; // fresh RTH read → no marker

  // Off-hours snapshots reflect the prior close; an RTH-but-old snapshot is merely delayed.
  const qualifier = isOffHours ? ", prior close" : ", delayed";
  return `· as of ${hh}:${mm} ET${qualifier}`;
}

/** Append the staleness marker to a "right now" brief answer, in place, when the read is stale. */
export function appendStalenessMarker(answer: string, asOf: string | null | undefined, now?: number): string {
  const marker = stalenessMarker(asOf, now);
  return marker ? `${answer}\n\n${marker}` : answer;
}
