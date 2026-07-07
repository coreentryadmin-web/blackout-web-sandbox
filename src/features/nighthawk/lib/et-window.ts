// Pure, DST-aware ET-window check for the fixed-UTC Railway cron guards. Lives in
// its own alias-free file (uses only the global Intl API) so it is unit-testable
// under `npx tsx --test` without dragging in the @/lib/* import chain that
// session.ts pulls. `now` is injectable so the window can be asserted at fixed
// instants across both EST and EDT. The ET hour/minute is derived via
// Intl.DateTimeFormat(America/New_York) — never a hard-coded UTC offset.
const ET = "America/New_York";

export function inEtWindow(
  opts: { targetHour: number; targetMinute: number; catchupMin: number; weekdaysOnly?: boolean },
  now: Date = new Date()
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  if ((opts.weekdaysOnly ?? true) && (weekday === "Sat" || weekday === "Sun")) return false;
  const nowMins = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  const target = opts.targetHour * 60 + opts.targetMinute;
  return nowMins >= target && nowMins <= target + opts.catchupMin;
}
