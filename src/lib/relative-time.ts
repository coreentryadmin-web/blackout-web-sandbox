// Shared, GUARDED relative-time + short-date formatters.
//
// Member-QA bug (2026-07-13): a missing/unparseable timestamp field rendered as "NaNh ago" in the
// HELIX flow-alert rows and "Invalid Date" in Night Hawk play rows — the SAME root cause in several
// duplicated, UNguarded local formatters (`new Date(x).getTime()` → NaN → `${Math.floor(NaN/60)}h
// ago`; `new Date(badYmd).toLocaleDateString()` → "Invalid Date"). These helpers guard null /
// undefined / "" / unparseable input and return a sensible fallback ("—") so a data gap degrades
// gracefully instead of leaking NaN/Invalid Date to the member.

/**
 * Relative age of an instant: "5s" / "5m" / "5h" / "3d" (append " ago" with `suffix`).
 * Returns `fallback` (default "—") for null/undefined/""/unparseable input, and clamps a
 * future timestamp to "0s" rather than emitting a negative age.
 */
export function relativeAge(
  input: string | number | Date | null | undefined,
  opts: { suffix?: boolean; fallback?: string } = {}
): string {
  const { suffix = false, fallback = "—" } = opts;
  if (input == null || input === "") return fallback;
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(t)) return fallback;
  const tail = suffix ? " ago" : "";
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s${tail}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${tail}`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${tail}`;
  return `${Math.floor(h / 24)}d${tail}`;
}

/**
 * Short "M/D" date (e.g. "7/13") from an ISO instant or a "YYYY-MM-DD" calendar date. A calendar
 * date is anchored at local noon so it never slips a day across time zones. Returns `fallback`
 * (default "—") for null/undefined/unparseable input instead of "Invalid Date".
 */
export function shortMonthDay(input: string | null | undefined, fallback = "—"): string {
  if (!input) return fallback;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T12:00:00`) : new Date(input);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}
