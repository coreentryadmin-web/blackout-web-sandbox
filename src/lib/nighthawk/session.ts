import { priorEtYmd, todayEtYmd } from "@/lib/providers/spx-session";

const ET = "America/New_York";

/** NYSE full-day closures — extend annually. */
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

export function todayEt(): string {
  return todayEtYmd();
}

export function priorEt(): string {
  return priorEtYmd();
}

export function formatEtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d);
}

export function isMarketHolidayEt(ymd: string): boolean {
  return US_MARKET_HOLIDAYS.has(ymd);
}

export function isTradingDayEt(ymd: string): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
  }).format(new Date(`${ymd}T12:00:00`));
  if (weekday === "Sat" || weekday === "Sun") return false;
  return !isMarketHolidayEt(ymd);
}

export function nextTradingDayEt(from?: string): string {
  const start = from ? new Date(`${from}T12:00:00`) : new Date();
  let cursor = new Date(start.getTime() + 86_400_000);
  for (let i = 0; i < 12; i++) {
    const ymd = formatEtDate(cursor);
    if (isTradingDayEt(ymd)) return ymd;
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return formatEtDate(cursor);
}

export function etNowParts(): { hour: number; minute: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

export function isWeekdayEt(): boolean {
  const { weekday } = etNowParts();
  return weekday !== "Sat" && weekday !== "Sun";
}

export function isBeforeOrAtMarketCloseEt(
  sessionYmd: string | null | undefined,
  now = new Date()
): boolean {
  if (!sessionYmd || !/^\d{4}-\d{2}-\d{2}$/.test(sessionYmd)) return false;
  if (!isTradingDayEt(sessionYmd)) return false;
  if (formatEtDate(now) !== sessionYmd) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins <= 16 * 60;
}
