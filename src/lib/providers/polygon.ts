import { trackedFetch } from "@/lib/api-tracked-fetch";
import { polygonConfigured } from "./config";
import { sessionStatsFromMinuteBars, todayEtYmd, priorEtYmd } from "./spx-session";

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = process.env.POLYGON_API_KEY ?? "";

async function polygonGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!polygonConfigured()) throw new Error("POLYGON_API_KEY not set");

  const qs = new URLSearchParams({ ...params, apiKey: KEY });
  const res = await trackedFetch("polygon", path, `${BASE}${path}?${qs}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Polygon ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

const LEADER_STOCKS = [
  { name: "Apple", ticker: "AAPL" },
  { name: "NVIDIA", ticker: "NVDA" },
  { name: "Microsoft", ticker: "MSFT" },
  { name: "Alphabet", ticker: "GOOG" },
  { name: "Tesla", ticker: "TSLA" },
  { name: "Meta", ticker: "META" },
];

const SECTOR_ETFS = [
  { name: "Technology", ticker: "XLK" },
  { name: "Financials", ticker: "XLF" },
  { name: "Energy", ticker: "XLE" },
  { name: "Healthcare", ticker: "XLV" },
  { name: "Industrials", ticker: "XLI" },
  { name: "Cons. Disc.", ticker: "XLY" },
  { name: "Cons. Staples", ticker: "XLP" },
  { name: "Utilities", ticker: "XLU" },
  { name: "Real Estate", ticker: "XLRE" },
  { name: "Materials", ticker: "XLB" },
  { name: "Comm. Svc.", ticker: "XLC" },
];

type SnapshotTicker = {
  ticker?: string;
  todaysChangePerc?: number;
  day?: { c?: number; h?: number; l?: number; vw?: number; v?: number };
  prevDay?: { c?: number };
  lastTrade?: { p?: number };
};

export type StockQuoteSnapshot = {
  ticker: string;
  price: number;
  prev_close: number;
  change_pct: number;
  day_high: number;
  day_low: number;
  vwap: number;
  volume: number;
};

export async function fetchStockSnapshot(ticker: string): Promise<StockQuoteSnapshot | null> {
  const sym = ticker.toUpperCase();
  const data = await polygonGet<{ ticker?: SnapshotTicker }>(
    `/v2/snapshot/locale/us/markets/stocks/tickers/${sym}`
  );
  const row = data.ticker;
  if (!row) return null;

  const day = row.day ?? {};
  const prev = row.prevDay ?? {};
  const last = row.lastTrade ?? {};
  const price = Number(last.p ?? day.c ?? 0);
  const prevClose = Number(prev.c ?? 0);
  const changePct =
    row.todaysChangePerc != null
      ? Number(row.todaysChangePerc.toFixed(2))
      : prevClose
        ? Number((((price - prevClose) / prevClose) * 100).toFixed(2))
        : 0;

  return {
    ticker: sym,
    price,
    prev_close: prevClose,
    change_pct: changePct,
    day_high: Number(day.h ?? price),
    day_low: Number(day.l ?? price),
    vwap: Number(day.vw ?? price),
    volume: Number(day.v ?? 0),
  };
}

async function fetchStockSnapshotPerformance(
  symbols: Array<{ name: string; ticker: string }>
) {
  const tickers = symbols.map((s) => s.ticker).join(",");
  const data = await polygonGet<{ tickers?: SnapshotTicker[] }>(
    "/v2/snapshot/locale/us/markets/stocks/tickers",
    { tickers }
  );

  const byTicker = new Map((data.tickers ?? []).map((t) => [t.ticker, t]));

  return symbols.map((symbol) => {
    const snap = byTicker.get(symbol.ticker);
    const change = snap?.todaysChangePerc ?? 0;
    return {
      name: symbol.name,
      ticker: symbol.ticker,
      change_pct: Number(change.toFixed(2)),
      volume: snap?.day?.v,
    };
  });
}

export function fetchLeaderStockSnapshots() {
  return fetchStockSnapshotPerformance(LEADER_STOCKS);
}

/** Mega-cap leaders + sector ETFs — used for breadth / TICK proxy. */
export function fetchBreadthUniverseSnapshots() {
  return fetchStockSnapshotPerformance([...LEADER_STOCKS, ...SECTOR_ETFS]);
}

export async function fetchSectorPerformance() {
  return fetchStockSnapshotPerformance(SECTOR_ETFS);
}

export async function fetchMarketMovers(limit = 20) {
  const [gainers, losers] = await Promise.all([
    polygonGet<{ tickers?: SnapshotTicker[] }>(
      "/v2/snapshot/locale/us/markets/stocks/gainers"
    ),
    polygonGet<{ tickers?: SnapshotTicker[] }>(
      "/v2/snapshot/locale/us/markets/stocks/losers"
    ),
  ]);

  const mapMover = (t: SnapshotTicker) => ({
    ticker: String(t.ticker ?? "").replace("X:", ""),
    change_pct: Number((t.todaysChangePerc ?? 0).toFixed(2)),
    price: t.day?.c ?? t.prevDay?.c ?? 0,
    volume: t.day?.v,
  });

  const combined = [
    ...(gainers.tickers ?? []).slice(0, limit).map(mapMover),
    ...(losers.tickers ?? []).slice(0, limit).map(mapMover),
  ];

  return combined.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
}

type IndexResult = {
  ticker?: string;
  value?: number;
  error?: string;
  message?: string;
  session?: {
    change?: number;
    change_percent?: number;
    close?: number;
    previous_close?: number;
  };
};

export type IndexQuote = {
  symbol: string;
  price: number;
  change_pct: number;
};

/** Batch index snapshots — Massive uses GET /v3/snapshot/indices?ticker.any_of=I:SPX,I:VIX */
export async function fetchIndexSnapshots(
  symbols: string[]
): Promise<Record<string, IndexQuote | null>> {
  const normalized = symbols.map((s) => s.toUpperCase());
  const out: Record<string, IndexQuote | null> = Object.fromEntries(
    normalized.map((s) => [s, null])
  );

  if (!normalized.length) return out;

  const data = await polygonGet<{ results?: IndexResult[] }>("/v3/snapshot/indices", {
    "ticker.any_of": normalized.join(","),
  });

  for (const row of data.results ?? []) {
    const ticker = row.ticker?.toUpperCase();
    if (!ticker || row.error) continue;

    out[ticker] = {
      symbol: ticker,
      price: row.value ?? row.session?.close ?? row.session?.previous_close ?? 0,
      change_pct: Number((row.session?.change_percent ?? 0).toFixed(2)),
    };
  }

  return out;
}

export async function fetchIndexSnapshot(symbol: string): Promise<IndexQuote | null> {
  const map = await fetchIndexSnapshots([symbol]);
  return map[symbol.toUpperCase()] ?? null;
}

export async function fetchBenzingaNews(
  limit = 12,
  opts?: { ticker?: string; channels?: string; since?: string }
) {
  const params: Record<string, string> = {
    limit: String(Math.min(limit, 50)),
    sort: "published.desc",
  };
  if (opts?.ticker) params["tickers.any_of"] = opts.ticker.toUpperCase();
  if (opts?.channels) params["channels.any_of"] = opts.channels;
  if (opts?.since) params["published.gte"] = opts.since;

  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    "/benzinga/v2/news",
    params
  );

  return (data.results ?? []).map((article) => ({
    id: String(article.id ?? article.benzinga_id ?? ""),
    title: String(article.title ?? ""),
    teaser: String(article.teaser ?? "").slice(0, 400),
    body: String(article.body ?? "").slice(0, 2000),
    published: String(article.published ?? article.created_at ?? ""),
    tickers: Array.isArray(article.tickers) ? article.tickers.map(String) : [],
    channels: Array.isArray(article.channels) ? article.channels.map(String) : [],
    tags: Array.isArray(article.tags) ? article.tags.map(String) : [],
    url: String(article.url ?? article.benzinga_url ?? ""),
    author: String(article.author ?? ""),
  }));
}

// ── SPX structure (indices) ───────────────────────────────────────────────────

type AggBar = { t?: number; o: number; h: number; l: number; c: number; v?: number };

function mapAggBars(results: Array<Record<string, unknown>> | undefined): AggBar[] {
  return (results ?? []).map((r) => ({
    t: Number(r.t),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: r.v != null ? Number(r.v) : undefined,
  }));
}

export async function fetchIndexMinuteBars(symbol: string, from: string, to: string) {
  const sym = symbol.toUpperCase();
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v2/aggs/ticker/${sym}/range/1/minute/${from}/${to}`,
    { limit: "5000", sort: "asc" }
  );
  return mapAggBars(data.results);
}

export async function fetchIndexDailyBars(
  symbol: string,
  from: string,
  to: string,
  limit = "10"
) {
  const sym = symbol.toUpperCase();
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v2/aggs/ticker/${sym}/range/1/day/${from}/${to}`,
    { limit, sort: "asc" }
  );
  return mapAggBars(data.results);
}

export async function fetchStockDailyBars(symbol: string, from: string, to: string, limit = "60") {
  const sym = symbol.toUpperCase();
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v2/aggs/ticker/${sym}/range/1/day/${from}/${to}`,
    { limit, sort: "asc" }
  );
  return mapAggBars(data.results);
}

type IndicatorValues = { values?: Array<{ value?: number }> };

async function latestIndicator(
  path: string,
  params: Record<string, string>
): Promise<number | null> {
  try {
    const data = await polygonGet<{ results?: IndicatorValues }>(path, params);
    const v = data.results?.values?.[0]?.value;
    return v != null ? Number(v) : null;
  } catch {
    return null;
  }
}

export async function fetchTickerEma(
  symbol: string,
  window: number,
  timespan: "minute" | "hour" | "day" = "day"
) {
  const sym = symbol.toUpperCase();
  return latestIndicator(`/v1/indicators/ema/${sym}`, {
    window: String(window),
    timespan,
    series_type: "close",
    order: "desc",
    limit: "1",
  });
}

export async function fetchTickerRsi(symbol: string, window = 14, timespan: "day" | "hour" = "day") {
  const sym = symbol.toUpperCase();
  return latestIndicator(`/v1/indicators/rsi/${sym}`, {
    window: String(window),
    timespan,
    series_type: "close",
    order: "desc",
    limit: "1",
  });
}

export async function fetchShortInterest(ticker: string) {
  const sym = ticker.toUpperCase();
  try {
    const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
      "/stocks/v1/short-interest",
      { ticker: sym, limit: "1", sort: "settlement_date.desc" }
    );
    const row = data.results?.[0];
    if (!row) return null;
    return {
      ticker: sym,
      settlement_date: String(row.settlement_date ?? ""),
      short_interest: Number(row.short_interest ?? 0),
      avg_daily_volume: Number(row.avg_daily_volume ?? 0),
      days_to_cover: Number(row.days_to_cover ?? 0),
      source: "massive_stocks_v1",
    };
  } catch {
    return null;
  }
}

export async function fetchShortVolume(ticker: string, limit = 5) {
  const sym = ticker.toUpperCase();
  try {
    const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
      "/stocks/v1/short-volume",
      { ticker: sym, limit: String(limit), sort: "date.desc" }
    );
    return (data.results ?? []).map((row) => ({
      date: String(row.date ?? ""),
      short_volume: Number(row.short_volume ?? 0),
      total_volume: Number(row.total_volume ?? 0),
      short_volume_ratio: Number(row.short_volume_ratio ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function fetchIndexEma(
  symbol: string,
  window: number,
  timespan: "minute" | "hour" | "day" = "minute"
) {
  const sym = symbol.toUpperCase();
  return latestIndicator(`/v1/indicators/ema/${sym}`, {
    window: String(window),
    timespan,
    series_type: "close",
    order: "desc",
    limit: "1",
  });
}

export async function fetchIndexSma(
  symbol: string,
  window: number,
  timespan: "minute" | "hour" | "day" = "day"
) {
  const sym = symbol.toUpperCase();
  return latestIndicator(`/v1/indicators/sma/${sym}`, {
    window: String(window),
    timespan,
    series_type: "close",
    order: "desc",
    limit: "1",
  });
}

/** Polygon has no `/v1/indicators/vwap` for indices — derive from RTH minute aggregates. */
export function computeIndexVwapFromBars(
  bars: Array<{ t?: number; o: number; h: number; l: number; c: number; v?: number }>
): number | null {
  return sessionStatsFromMinuteBars(bars).vwap;
}

export async function fetchIndexVwap(symbol: string, timespan: "minute" | "day" = "minute") {
  const sym = symbol.toUpperCase();
  const today = todayEtYmd();
  const bars =
    timespan === "day"
      ? await fetchIndexDailyBars(sym, today, today).catch(() => [])
      : await fetchIndexMinuteBars(sym, today, today).catch(() => []);
  return computeIndexVwapFromBars(bars);
}

export type VixTermSnapshot = {
  vix9d: number | null;
  vix3m: number | null;
  structure: "contango" | "backwardation" | "flat" | "unknown";
  detail: string;
};

export function computeVixTermStructure(
  spot: number | null,
  near: number | null,
  far: number | null
): VixTermSnapshot {
  if (spot == null || near == null) {
    return { vix9d: near, vix3m: far, structure: "unknown", detail: "Insufficient VIX term data" };
  }
  const spreadNear = near - spot;
  if (far != null) {
    const spreadFar = far - spot;
    if (spreadNear > 0.5 && spreadFar > spreadNear) {
      return {
        vix9d: near,
        vix3m: far,
        structure: "contango",
        detail: `Contango — near +${spreadNear.toFixed(2)}, far +${spreadFar.toFixed(2)}`,
      };
    }
    if (spreadNear < -0.5) {
      return {
        vix9d: near,
        vix3m: far,
        structure: "backwardation",
        detail: `Backwardation — front below spot`,
      };
    }
    return { vix9d: near, vix3m: far, structure: "flat", detail: `Flat — spot ${spot.toFixed(2)}` };
  }
  if (spreadNear > 0.5) {
    return { vix9d: near, vix3m: far, structure: "contango", detail: `Contango +${spreadNear.toFixed(2)}` };
  }
  if (spreadNear < -0.5) {
    return { vix9d: near, vix3m: far, structure: "backwardation", detail: `Backwardation ${spreadNear.toFixed(2)}` };
  }
  return { vix9d: near, vix3m: far, structure: "flat", detail: `Flat term` };
}

const VIX = "I:VIX";
let cachedVixIvRank: { at: number; rank: number | null } | null = null;

/** VIX percentile vs ~1y of daily closes — Polygon Indices Advanced (replaces UW IV rank when available). */
export async function fetchVixIvRankPercentile(): Promise<number | null> {
  if (!polygonConfigured()) return null;
  const now = Date.now();
  if (cachedVixIvRank && now - cachedVixIvRank.at < 300_000) {
    return cachedVixIvRank.rank;
  }

  const today = todayEtYmd();
  const from = priorEtYmd(400);
  const [snaps, bars] = await Promise.all([
    fetchIndexSnapshots([VIX]),
    fetchIndexDailyBars(VIX, from, today, "300").catch(() => []),
  ]);
  const current = snaps[VIX]?.price;
  if (current == null || current <= 0 || !bars.length) {
    cachedVixIvRank = { at: now, rank: null };
    return null;
  }

  const closes = bars.map((b) => b.c).filter((c) => c > 0);
  if (closes.length < 20) {
    cachedVixIvRank = { at: now, rank: null };
    return null;
  }

  const below = closes.filter((c) => c <= current).length;
  const rank = Math.round((below / closes.length) * 100);
  cachedVixIvRank = { at: now, rank };
  return rank;
}

export type PolygonMarketNow = {
  market: string;
  earlyHours: boolean;
  afterHours: boolean;
  serverTime: string;
};

/** GET /v1/marketstatus/now — RTH / extended / closed. */
export async function fetchMarketStatusNow(): Promise<PolygonMarketNow | null> {
  if (!polygonConfigured()) return null;
  try {
    const data = await polygonGet<{
      market?: string;
      earlyHours?: boolean;
      afterHours?: boolean;
      serverTime?: string;
    }>("/v1/marketstatus/now", {});
    if (!data?.market) return null;
    return {
      market: String(data.market),
      earlyHours: Boolean(data.earlyHours),
      afterHours: Boolean(data.afterHours),
      serverTime: String(data.serverTime ?? ""),
    };
  } catch {
    return null;
  }
}

