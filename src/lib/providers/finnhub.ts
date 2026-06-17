import { finnhubConfigured } from "./config";
import { trackedFetch } from "@/lib/api-tracked-fetch";

const BASE = "https://finnhub.io/api/v1";

export type MacroEvent = {
  time: string;
  event: string;
  country: string;
  impact: string;
  actual?: string | null;
  estimate?: string | null;
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function finnhubGet<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!finnhubConfigured() || !key) return null;

  const qs = new URLSearchParams({ ...params, token: key });
  try {
    const res = await trackedFetch(
      "finnhub",
      path,
      `${BASE}${path}?${qs}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Today's US macro events — requires Finnhub Economic Data subscription ($50/mo). Free tier returns null. */
export async function fetchEconomicCalendarToday(): Promise<MacroEvent[]> {
  const from = todayUtc();
  const data = await finnhubGet<{ economicCalendar?: Array<Record<string, unknown>> }>(
    "/calendar/economic",
    { from, to: from }
  );

  const rows = data?.economicCalendar ?? [];
  return rows
    .filter((r) => String(r.country ?? "").toUpperCase() === "US")
    .map((r) => ({
      time: String(r.time ?? r.date ?? ""),
      event: String(r.event ?? r.title ?? ""),
      country: String(r.country ?? "US"),
      impact: String(r.impact ?? "low"),
      actual: r.actual != null ? String(r.actual) : null,
      estimate: r.estimate != null ? String(r.estimate) : null,
    }))
    .filter((e) => e.event)
    .slice(0, 8);
}
