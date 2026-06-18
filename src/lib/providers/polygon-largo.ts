/**
 * Extended Polygon/Massive endpoints for Largo terminal.
 * Primary data source — unlimited calls on paid plan.
 */
import { trackedFetch } from "@/lib/api-tracked-fetch";
import { polygonConfigured } from "./config";
import { priorEtYmd, todayEtYmd } from "./spx-session";

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = process.env.POLYGON_API_KEY ?? "";

export type AggBar = { t?: number; o: number; h: number; l: number; c: number; v?: number };

async function polygonGet<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!polygonConfigured()) return null;
  const qs = new URLSearchParams({ ...params, apiKey: KEY });
  try {
    const res = await trackedFetch("polygon", path, `${BASE}${path}?${qs}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function mapBars(results: Array<Record<string, unknown>> | undefined): AggBar[] {
  return (results ?? []).map((r) => ({
    t: Number(r.t),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: r.v != null ? Number(r.v) : undefined,
  }));
}

export async function fetchAggBars(
  symbol: string,
  multiplier: number,
  timespan: "minute" | "hour" | "day" | "week",
  from: string,
  to: string,
  limit = "500"
): Promise<AggBar[]> {
  const sym = symbol.toUpperCase();
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v2/aggs/ticker/${sym}/range/${multiplier}/${timespan}/${from}/${to}`,
    { limit, sort: "asc" }
  );
  return mapBars(data?.results);
}

export async function fetchPreviousDayBar(symbol: string): Promise<AggBar | null> {
  const sym = symbol.toUpperCase();
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v2/aggs/ticker/${sym}/prev`,
    {}
  );
  const row = data?.results?.[0];
  if (!row) return null;
  return {
    t: Number(row.t),
    o: Number(row.o),
    h: Number(row.h),
    l: Number(row.l),
    c: Number(row.c),
    v: row.v != null ? Number(row.v) : undefined,
  };
}

type IndicatorBlock = { values?: Array<{ value?: number; timestamp?: number }> };

async function latestIndicator(path: string, params: Record<string, string>): Promise<number | null> {
  const data = await polygonGet<{ results?: IndicatorBlock }>(path, {
    ...params,
    order: "desc",
    limit: "1",
    series_type: "close",
  });
  const v = data?.results?.values?.[0]?.value;
  return v != null ? Number(v) : null;
}

export async function fetchPolygonMacd(
  symbol: string,
  timespan: "minute" | "hour" | "day" = "day"
) {
  const sym = symbol.toUpperCase();
  const data = await polygonGet<{
    results?: {
      values?: Array<{ value?: number; signal?: number; histogram?: number }>;
    };
  }>(`/v1/indicators/macd/${sym}`, {
    timespan,
    short_window: "12",
    long_window: "26",
    signal_window: "9",
    order: "desc",
    limit: "1",
    series_type: "close",
  });
  const row = data?.results?.values?.[0];
  if (!row) return null;
  return {
    macd: Number(row.value ?? 0),
    signal: Number(row.signal ?? 0),
    histogram: Number(row.histogram ?? 0),
  };
}

export async function fetchPolygonRsi(
  symbol: string,
  window = 14,
  timespan: "minute" | "hour" | "day" = "day"
) {
  return latestIndicator(`/v1/indicators/rsi/${symToPath(symbol)}`, {
    window: String(window),
    timespan,
  });
}

export async function fetchPolygonEma(
  symbol: string,
  window: number,
  timespan: "minute" | "hour" | "day" = "day"
) {
  return latestIndicator(`/v1/indicators/ema/${symToPath(symbol)}`, {
    window: String(window),
    timespan,
  });
}

export async function fetchPolygonSma(
  symbol: string,
  window: number,
  timespan: "minute" | "hour" | "day" = "day"
) {
  return latestIndicator(`/v1/indicators/sma/${symToPath(symbol)}`, {
    window: String(window),
    timespan,
  });
}

function symToPath(symbol: string): string {
  return symbol.toUpperCase();
}

export async function fetchPolygonTickerDetails(ticker: string) {
  return polygonGet<Record<string, unknown>>(`/v3/reference/tickers/${ticker.toUpperCase()}`, {});
}

export async function fetchPolygonNews(ticker: string, limit = 15) {
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    "/v2/reference/news",
    { ticker: ticker.toUpperCase(), limit: String(limit), order: "desc", sort: "published_utc" }
  );
  return (data?.results ?? []).map((a) => {
    const insights = Array.isArray(a.insights)
      ? (a.insights as Array<Record<string, unknown>>).map((i) => ({
          ticker: String(i.ticker ?? ""),
          sentiment: String(i.sentiment ?? ""),
          reasoning: String(i.sentiment_reasoning ?? "").slice(0, 200),
        }))
      : [];
    return {
      title: String(a.title ?? ""),
      author: String(a.author ?? ""),
      published: String(a.published_utc ?? ""),
      description: String(a.description ?? "").slice(0, 400),
      url: String(a.article_url ?? ""),
      tickers: Array.isArray(a.tickers) ? a.tickers.map(String) : [],
      keywords: Array.isArray(a.keywords) ? a.keywords.map(String) : [],
      insights,
      publisher: (a.publisher as Record<string, unknown>)?.name ?? "",
    };
  });
}

export function computeLevelsFromBars(bars: AggBar[], price: number) {
  if (!bars.length) return { support: null, resistance: null, vwap: null, trend: "unknown" as const };

  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    const v = b.v ?? 0;
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * v;
    vol += v;
  }
  const vwap = vol > 0 ? Number((pv / vol).toFixed(2)) : null;

  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const resistance = Math.max(...highs.slice(-20));
  const support = Math.min(...lows.slice(-20));

  const emaProxy = bars.slice(-20).reduce((s, b) => s + b.c, 0) / Math.min(20, bars.length);
  const trend = price > emaProxy ? ("bullish" as const) : price < emaProxy ? ("bearish" as const) : ("flat" as const);

  return {
    support: Number(support.toFixed(2)),
    resistance: Number(resistance.toFixed(2)),
    vwap,
    trend,
  };
}

/** Full multi-timeframe technical snapshot — Polygon primary. */
export async function fetchPolygonMtfTechnicals(ticker: string) {
  const sym = ticker.toUpperCase();
  const isIndex = sym === "SPX" || sym === "VIX" || sym.startsWith("I:");
  const polygonSym = sym === "SPX" ? "I:SPX" : sym === "VIX" ? "I:VIX" : sym;

  const today = todayEtYmd();
  const fromDaily = priorEtYmd(120);
  const fromHour = priorEtYmd(30);
  const fromMin = today;

  const [daily, hourly, minute15, prevDay] = await Promise.all([
    fetchAggBars(polygonSym, 1, "day", fromDaily, today, "120"),
    fetchAggBars(polygonSym, 1, "hour", fromHour, today, "500"),
    fetchAggBars(polygonSym, 15, "minute", fromMin, today, "500"),
    fetchPreviousDayBar(polygonSym),
  ]);

  const price = daily.at(-1)?.c ?? hourly.at(-1)?.c ?? 0;

  const [ema20d, ema50d, ema200d, rsi14d, macdD, ema20h, rsi14h, ema20m, rsi14m] = await Promise.all([
    fetchPolygonEma(polygonSym, 20, "day"),
    fetchPolygonEma(polygonSym, 50, "day"),
    fetchPolygonEma(polygonSym, 200, "day"),
    fetchPolygonRsi(polygonSym, 14, "day"),
    fetchPolygonMacd(polygonSym, "day"),
    fetchPolygonEma(polygonSym, 20, "hour"),
    fetchPolygonRsi(polygonSym, 14, "hour"),
    fetchPolygonEma(polygonSym, 20, "minute"),
    fetchPolygonRsi(polygonSym, 14, "minute"),
  ]);

  const dailyLv = computeLevelsFromBars(daily, price);
  const hourlyLv = computeLevelsFromBars(hourly, price);
  const minLv = computeLevelsFromBars(minute15, price);

  let atr14: number | null = null;
  if (daily.length >= 15) {
    const trs: number[] = [];
    for (let i = 1; i < daily.length; i++) {
      const cur = daily[i];
      const prev = daily[i - 1];
      trs.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)));
    }
    atr14 = Number((trs.slice(-14).reduce((a, b) => a + b, 0) / 14).toFixed(2));
  }

  const trendStack =
    price > (ema20d ?? 0) && (ema20d ?? 0) > (ema50d ?? 0)
      ? "bullish"
      : price < (ema20d ?? 0) && (ema20d ?? 0) < (ema50d ?? 0)
        ? "bearish"
        : "mixed";

  const rangeHigh20 = daily.length ? Math.max(...daily.slice(-20).map((b) => b.h)) : null;
  const rangeLow20 = daily.length ? Math.min(...daily.slice(-20).map((b) => b.l)) : null;
  const weekSlice = daily.slice(-5);
  const monthSlice = daily.slice(-22);

  return {
    ticker: polygonSym,
    price,
    is_index: isIndex,
    trend_stack: trendStack,
    atr14,
    prev_day: prevDay
      ? { open: prevDay.o, high: prevDay.h, low: prevDay.l, close: prevDay.c, volume: prevDay.v }
      : null,
    emas: { ema20: ema20d, ema50: ema50d, ema200: ema200d },
    rsi: { daily: rsi14d, hourly: rsi14h, m15: rsi14m },
    macd: { daily: macdD },
    timeframes: {
      daily: { ...dailyLv, ema20: ema20d, rsi14: rsi14d },
      hourly: { ...hourlyLv, ema20: ema20h, rsi14: rsi14h },
      m15: { ...minLv, ema20: ema20m, rsi14: rsi14m },
    },
    range_high_20d: rangeHigh20,
    range_low_20d: rangeLow20,
    weekly: {
      high: weekSlice.length ? Math.max(...weekSlice.map((b) => b.h)) : null,
      low: weekSlice.length ? Math.min(...weekSlice.map((b) => b.l)) : null,
      support: weekSlice.length ? Number(Math.min(...weekSlice.map((b) => b.l)).toFixed(2)) : null,
      resistance: weekSlice.length ? Number(Math.max(...weekSlice.map((b) => b.h)).toFixed(2)) : null,
    },
    monthly: {
      high: monthSlice.length ? Math.max(...monthSlice.map((b) => b.h)) : null,
      low: monthSlice.length ? Math.min(...monthSlice.map((b) => b.l)) : null,
      support: monthSlice.length ? Number(Math.min(...monthSlice.map((b) => b.l)).toFixed(2)) : null,
      resistance: monthSlice.length ? Number(Math.max(...monthSlice.map((b) => b.h)).toFixed(2)) : null,
    },
    data_source: "polygon",
  };
}

export async function fetchStockLastNbbo(ticker: string) {
  const sym = ticker.toUpperCase().replace(/^I:/, "");
  const data = await polygonGet<{ results?: Record<string, unknown> }>(`/v2/last/nbbo/${sym}`, {});
  return data?.results ?? null;
}

export async function fetchStockLastTrade(ticker: string) {
  const sym = ticker.toUpperCase().replace(/^I:/, "");
  const data = await polygonGet<{ results?: Record<string, unknown> }>(`/v2/last/trade/${sym}`, {});
  return data?.results ?? null;
}

export async function fetchOpenClose(ticker: string, date?: string) {
  const sym = ticker.toUpperCase().replace(/^I:/, "");
  const d = date ?? priorEtYmd();
  return polygonGet<Record<string, unknown>>(`/v1/open-close/${sym}/${d}`, {});
}

export async function fetchMarketUpcomingStatus() {
  return polygonGet<Record<string, unknown>>("/v1/marketstatus/upcoming", {});
}

export async function fetchPolygonMarketNews(limit = 15) {
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>("/v2/reference/news", {
    limit: String(limit),
    order: "desc",
    sort: "published_utc",
  });
  return (data?.results ?? []).map((a) => ({
    title: String(a.title ?? ""),
    published: String(a.published_utc ?? ""),
    description: String(a.description ?? "").slice(0, 300),
    tickers: Array.isArray(a.tickers) ? a.tickers.map(String) : [],
    url: String(a.article_url ?? ""),
  }));
}

export async function fetchRelatedTickers(ticker: string) {
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v3/reference/tickers/${ticker.toUpperCase()}/related`,
    {}
  );
  return data?.results ?? [];
}

export async function fetchStockFloat(ticker: string) {
  return polygonGet<Record<string, unknown>>(`/stocks/v1/float`, { ticker: ticker.toUpperCase() });
}
