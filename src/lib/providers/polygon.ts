import { trackedFetch } from "@/lib/api-tracked-fetch";
import { computeVixTermStructure, type VixTermSnapshot } from "@/lib/vix-term-utils";
export { computeVixTermStructure, type VixTermSnapshot } from "@/lib/vix-term-utils";
import { polygonConfigured } from "./config";
import { sessionStatsFromMinuteBars, todayEtYmd, priorEtYmd } from "./spx-session";

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = process.env.POLYGON_API_KEY ?? "";

let _poly429Count = 0;
let _polyCircuitOpenUntil = 0;
const POLY_429_THRESHOLD = 5;
const POLY_CIRCUIT_PAUSE_MS = 60_000;

async function polygonGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!polygonConfigured()) throw new Error("POLYGON_API_KEY not set");

  if (Date.now() < _polyCircuitOpenUntil) {
    const waitSec = Math.ceil((_polyCircuitOpenUntil - Date.now()) / 1000);
    throw new Error(`[polygon] Circuit open — rate limited, pausing ${waitSec}s`);
  }

  const qs = new URLSearchParams({ ...params, apiKey: KEY });
  const res = await trackedFetch("polygon", path, `${BASE}${path}?${qs}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (res.status === 429) {
    _poly429Count++;
    if (_poly429Count >= POLY_429_THRESHOLD) {
      _polyCircuitOpenUntil = Date.now() + POLY_CIRCUIT_PAUSE_MS;
      _poly429Count = 0;
      console.warn(`[polygon] Circuit opened after ${POLY_429_THRESHOLD} consecutive 429s — pausing 60s`);
    }
    throw new Error(`Polygon ${path} → 429 (rate limited)`);
  }

  if (res.ok) _poly429Count = 0;

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

function _rowToSnapshot(sym: string, row: SnapshotTicker): StockQuoteSnapshot {
  const day = row.day ?? {};
  const prev = row.prevDay ?? {};
  const last = row.lastTrade ?? {};
  const price = Number(last.p ?? day.c ?? 0);
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) {
    throw new Error(`[polygon] Invalid price for ${sym}: ${price}`);
  }
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

export async function fetchStockSnapshot(ticker: string): Promise<StockQuoteSnapshot | null> {
  const sym = ticker.toUpperCase();
  const data = await polygonGet<{ ticker?: SnapshotTicker }>(
    `/v2/snapshot/locale/us/markets/stocks/tickers/${sym}`
  );
  const row = data.ticker;
  if (!row) return null;
  try {
    return _rowToSnapshot(sym, row);
  } catch (err) {
    console.warn(`[polygon] snapshot validation failed for ${sym}:`, err);
    return null;
  }
}

/** Batch snapshot — one HTTP call for multiple stock/ETF tickers. */
export async function fetchStockSnapshots(
  tickers: string[]
): Promise<Record<string, StockQuoteSnapshot | null>> {
  const syms = tickers.map((t) => t.toUpperCase());
  const out: Record<string, StockQuoteSnapshot | null> = Object.fromEntries(
    syms.map((s) => [s, null])
  );
  if (!syms.length) return out;

  const data = await polygonGet<{ tickers?: SnapshotTicker[] }>(
    "/v2/snapshot/locale/us/markets/stocks/tickers",
    { tickers: syms.join(",") }
  );
  for (const row of data.tickers ?? []) {
    const sym = row.ticker?.toUpperCase();
    if (!sym || !out.hasOwnProperty(sym)) continue;
    try {
      out[sym] = _rowToSnapshot(sym, row);
    } catch {
      // Leave out[sym] as null — bad price data for this ticker
    }
  }
  return out;
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

export type DailyMarketBar = {
  T: string;
  o: number;
  h: number;
  l: number;
  c: number;
  vw: number;
  v: number;
};

export type MarketBreadthMetrics = {
  advance_decline_ratio: number | null;
  pct_above_vwap: number | null;
  pct_advancing: number | null;
  /** Count of stocks that CLOSED within 0.2% of their intraday high/low.
   *  NOTE: this is "closed strong/weak", NOT 52-week new highs/lows. */
  closed_near_high: number;
  closed_near_low: number;
  volume_leaders: Array<{ ticker: string; volume: number; change_pct: number }>;
  sample_size: number;
};

/** Full-market OHLC+VWAP — one call for breadth internals. */
export async function fetchDailyMarketSummary(date: string) {
  return polygonGet<{ results?: DailyMarketBar[] }>(
    `/v2/aggs/grouped/locale/us/market/stocks/${date}`,
    { adjusted: "true", include_otc: "false" }
  );
}

/**
 * Ticker→close map for the most recent trading day strictly before `beforeYmd`.
 * Walks back up to `maxLookback` calendar days to skip weekends/holidays (empty
 * grouped results). Returns {} on failure so breadth degrades gracefully.
 */
export async function fetchPriorDayCloses(
  beforeYmd: string,
  maxLookback = 5
): Promise<Record<string, number>> {
  const base = new Date(`${beforeYmd}T12:00:00`);
  for (let i = 1; i <= maxLookback; i++) {
    const d = new Date(base.getTime() - i * 86_400_000);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
    try {
      const data = await fetchDailyMarketSummary(ymd);
      const results = data.results ?? [];
      if (!results.length) continue;
      const map: Record<string, number> = {};
      for (const row of results) {
        const t = String(row.T ?? "");
        const c = Number(row.c ?? 0);
        if (t && c > 0) map[t] = c;
      }
      return map;
    } catch {
      /* try the next day back */
    }
  }
  return {};
}

export function computeMarketBreadthFromSummary(
  results: DailyMarketBar[],
  priorCloseByTicker?: Record<string, number>
): MarketBreadthMetrics {
  let advancing = 0;
  let declining = 0;
  let aboveVwap = 0;
  let closedNearHigh = 0;
  let closedNearLow = 0;
  const byVolume: Array<{ ticker: string; volume: number; change_pct: number }> = [];

  for (const row of results) {
    const ticker = String(row.T ?? "");
    if (!ticker || ticker.includes(".")) continue;
    const c = Number(row.c ?? 0);
    const o = Number(row.o ?? 0);
    const vw = Number(row.vw ?? 0);
    const h = Number(row.h ?? 0);
    const l = Number(row.l ?? 0);
    const v = Number(row.v ?? 0);
    if (c <= 0 || o <= 0) continue;

    // True advance/decline = close vs PRIOR close when available; fall back to
    // close-vs-open (session direction) only if no prior-close map was supplied.
    const prior = priorCloseByTicker?.[ticker];
    const ref = prior != null && prior > 0 ? prior : o;
    if (c > ref) advancing++;
    else if (c < ref) declining++;
    if (vw > 0 && c > vw) aboveVwap++;
    if (h > 0 && c >= h * 0.998) closedNearHigh++;
    if (l > 0 && c <= l * 1.002) closedNearLow++;

    byVolume.push({
      ticker,
      volume: v,
      change_pct: Number((((c - ref) / ref) * 100).toFixed(2)),
    });
  }

  const sample = advancing + declining;
  byVolume.sort((a, b) => b.volume - a.volume);

  return {
    advance_decline_ratio:
      declining > 0 ? Number((advancing / declining).toFixed(2)) : sample > 0 ? advancing : null,
    pct_above_vwap: sample > 0 ? Number(((aboveVwap / sample) * 100).toFixed(1)) : null,
    pct_advancing: sample > 0 ? Number(((advancing / sample) * 100).toFixed(1)) : null,
    closed_near_high: closedNearHigh,
    closed_near_low: closedNearLow,
    volume_leaders: byVolume.slice(0, 8),
    sample_size: sample,
  };
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

export async function fetchBenzingaEarnings(ticker: string, limit = 15) {
  return fetchBenzingaNews(limit, { ticker, channels: "earnings" });
}

export async function fetchBenzingaAnalystRatings(ticker: string, limit = 15) {
  return fetchBenzingaNews(limit, { ticker, channels: "analyst-ratings" });
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

export async function fetchIndex5MinBars(symbol: string, from: string, to: string) {
  const sym = symbol.toUpperCase();
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v2/aggs/ticker/${sym}/range/5/minute/${from}/${to}`,
    { limit: "500", sort: "asc" }
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

export type PolygonFinancialRatios = {
  pe_ratio: number | null;
  roe: number | null;
  debt_to_equity: number | null;
  as_of: string | null;
};

function ratioNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** TTM valuation / leverage ratios — GET /stocks/financials/v1/ratios */
export async function fetchPolygonFinancialRatios(ticker: string): Promise<PolygonFinancialRatios | null> {
  const sym = ticker.toUpperCase();
  try {
    const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
      "/stocks/financials/v1/ratios",
      { ticker: sym, limit: "1", sort: "date", order: "desc" }
    );
    const row = data.results?.[0];
    if (!row) return null;
    return {
      pe_ratio: ratioNum(
        row.price_to_earnings ?? row.pe_ratio ?? row.price_to_earnings_ratio ?? row.priceToEarnings
      ),
      roe: ratioNum(row.return_on_equity ?? row.roe ?? row.returnOnEquity),
      debt_to_equity: ratioNum(
        row.debt_to_equity ?? row.debt_to_equity_ratio ?? row.debtToEquity
      ),
      as_of: row.date != null ? String(row.date).slice(0, 10) : null,
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

export async function fetchIndexRsi(
  symbol: string,
  window = 14,
  timespan: "minute" | "hour" | "day" = "minute"
): Promise<number | null> {
  const sym = symbol.startsWith("I:") ? encodeURIComponent(symbol) : encodeURIComponent(`I:${symbol}`);
  const data = await polygonGet<{ results?: { values?: Array<{ value?: number }> } }>(
    `/v1/indicators/rsi/${sym}`,
    { window: String(window), timespan, series_type: "close", limit: "1" }
  );
  const v = data?.results?.values?.[0]?.value;
  return v != null && Number.isFinite(v) ? v : null;
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

let marketStatusCache: { data: PolygonMarketNow | null; fetchedAt: number } = { data: null, fetchedAt: 0 };
const MARKET_STATUS_CACHE_MS = 60_000;

/** GET /v1/marketstatus/now — RTH / extended / closed. Cached 60s to avoid ~23k calls/day at 1s pulse. */
export async function fetchMarketStatusNow(): Promise<PolygonMarketNow | null> {
  if (!polygonConfigured()) return null;
  if (Date.now() - marketStatusCache.fetchedAt < MARKET_STATUS_CACHE_MS) {
    return marketStatusCache.data;
  }
  try {
    const data = await polygonGet<{
      market?: string;
      earlyHours?: boolean;
      afterHours?: boolean;
      serverTime?: string;
    }>("/v1/marketstatus/now", {});
    if (!data?.market) return null;
    const result: PolygonMarketNow = {
      market: String(data.market),
      earlyHours: Boolean(data.earlyHours),
      afterHours: Boolean(data.afterHours),
      serverTime: String(data.serverTime ?? ""),
    };
    marketStatusCache = { data: result, fetchedAt: Date.now() };
    return result;
  } catch {
    return marketStatusCache.data; // return last good value on error
  }
}

