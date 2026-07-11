/**
 * Display locale for the Vector lightweight-charts instance.
 *
 * lightweight-charts formats every time-axis tick and the crosshair time label through
 * `Intl.DateTimeFormat(locale, …)`, where `locale` defaults to the runtime's
 * `navigator.language`. When that default is a BCP-47 tag Intl rejects — observed in a
 * headless/embedded browser reporting the POSIX-style `"en-US@posix"` — the format call
 * throws *inside the chart's paint path*, so the whole canvas renders blank (no candles,
 * no axes) even though `series.setData()` succeeded. Pinning an explicit, valid locale
 * makes the render independent of whatever the client (or E2E/screenshot tooling) reports.
 *
 * Vector is a US-index / US-options desk, so `en-US` is the correct display locale.
 */
export const VECTOR_CHART_LOCALE = "en-US";

/** True when `locale` is a tag Intl can actually format with (i.e. won't throw at paint). */
export function isUsableChartLocale(locale: string): boolean {
  try {
    // Same shape of call lightweight-charts makes when it formats the time axis.
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(0);
    return true;
  } catch {
    return false;
  }
}
