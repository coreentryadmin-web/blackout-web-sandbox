import { priorEtYmd, todayEtYmd } from "@/lib/providers/spx-session";

const ET = "America/New_York";

export function todayEt(): string {
  return todayEtYmd();
}

export function priorEt(): string {
  return priorEtYmd();
}

export function formatEtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d);
}

export function nextTradingDayEt(from?: string): string {
  const start = from ? new Date(`${from}T12:00:00`) : new Date();
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short" });
  let cursor = new Date(start.getTime() + 86_400_000);
  for (let i = 0; i < 8; i++) {
    const day = weekday.format(cursor);
    if (day !== "Sat" && day !== "Sun") {
      return formatEtDate(cursor);
    }
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
