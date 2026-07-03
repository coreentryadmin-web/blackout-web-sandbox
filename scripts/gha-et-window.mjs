/** ET window helpers for GitHub Actions RTH workflows (no deps). */
const ET = "America/New_York";

/** NYSE full-day closures — keep in sync with src/lib/nighthawk/session.ts */
const US_MARKET_HOLIDAYS = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-04-02",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
]);

export function todayEtYmd(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(now);
}

export function isMarketHolidayEt(ymd) {
  return US_MARKET_HOLIDAYS.has(ymd);
}

/** Weekday and not a full NYSE closure (e.g. Jul 3 when Jul 4 is Saturday). */
export function isTradingDayEt(ymd) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
  }).format(new Date(`${ymd}T12:00:00`));
  if (weekday === "Sat" || weekday === "Sun") return false;
  return !isMarketHolidayEt(ymd);
}

export function etParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    weekday: parts.weekday,
    mins: hour * 60 + minute,
    label: `${parts.weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`,
  };
}

/** Mon–Fri 09:00–16:15 ET (RTH + 15m post-close grace for crons). */
export function inRthOpenWindow(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return mins >= 9 * 60 && mins <= 16 * 60 + 15;
}

export function isWeekdayEt(now = new Date()) {
  const { weekday } = etParts(now);
  return weekday !== "Sat" && weekday !== "Sun";
}
