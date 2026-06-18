import { finnhubConfigured, finnhubEconomicCalendarEnabled } from "./config";
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

/** Today's US macro events — requires Finnhub Economic Data subscription ($50/mo). */
export async function fetchEconomicCalendarToday(): Promise<MacroEvent[]> {
  if (!finnhubEconomicCalendarEnabled()) return [];

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

export async function fetchFinnhubCompanyProfile(ticker: string) {
  return finnhubGet<Record<string, unknown>>("/stock/profile2", {
    symbol: ticker.toUpperCase(),
  });
}

export async function fetchFinnhubRecommendations(ticker: string) {
  return finnhubGet<Array<Record<string, unknown>>>("/stock/recommendation", {
    symbol: ticker.toUpperCase(),
  });
}

export async function fetchFinnhubEarningsCalendar(ticker: string, daysAhead = 90) {
  const from = todayUtc();
  const to = new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
  return finnhubGet<{ earningsCalendar?: Array<Record<string, unknown>> }>("/calendar/earnings", {
    from,
    to,
    symbol: ticker.toUpperCase(),
  });
}

export async function fetchFinnhubBasicMetrics(ticker: string) {
  return finnhubGet<Record<string, unknown>>("/stock/metric", {
    symbol: ticker.toUpperCase(),
    metric: "all",
  });
}

export async function fetchFinnhubCompanyNews(ticker: string, daysBack = 7) {
  const to = todayUtc();
  const from = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  return finnhubGet<Array<Record<string, unknown>>>("/company-news", {
    symbol: ticker.toUpperCase(),
    from,
    to,
  });
}

export async function fetchFinnhubPriceTarget(ticker: string) {
  return finnhubGet<Record<string, unknown>>("/stock/price-target", {
    symbol: ticker.toUpperCase(),
  });
}

export async function fetchFinnhubInsiderTransactions(ticker: string) {
  return finnhubGet<Array<Record<string, unknown>>>("/stock/insider-transactions", {
    symbol: ticker.toUpperCase(),
  });
}

export async function fetchFinnhubIpoCalendar(from?: string, to?: string) {
  const f = from ?? todayUtc();
  const t = to ?? new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  return finnhubGet<{ ipoCalendar?: Array<Record<string, unknown>> }>("/calendar/ipo", {
    from: f,
    to: t,
  });
}

export async function fetchFinnhubEconomicCalendarRange(from: string, to: string) {
  if (!finnhubEconomicCalendarEnabled()) return null;
  return finnhubGet<{ economicCalendar?: Array<Record<string, unknown>> }>("/calendar/economic", {
    from,
    to,
  });
}
