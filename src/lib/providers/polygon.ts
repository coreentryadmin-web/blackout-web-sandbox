import { trackedFetch } from "@/lib/api-tracked-fetch";
import { polygonConfigured } from "./config";

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
  day?: { c?: number; v?: number };
  prevDay?: { c?: number };
};

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

export async function fetchBenzingaNews(limit = 12) {
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    "/benzinga/v2/news",
    { limit: String(limit), sort: "published.desc" }
  );

  return (data.results ?? []).map((article) => ({
    id: String(article.id ?? article.benzinga_id ?? ""),
    title: String(article.title ?? ""),
    teaser: String(article.teaser ?? article.body ?? "").slice(0, 280),
    published: String(article.published ?? article.created_at ?? ""),
    tickers: Array.isArray(article.tickers) ? article.tickers.map(String) : [],
    url: String(article.url ?? article.benzinga_url ?? ""),
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

export async function fetchIndexDailyBars(symbol: string, from: string, to: string) {
  const sym = symbol.toUpperCase();
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v2/aggs/ticker/${sym}/range/1/day/${from}/${to}`,
    { limit: "10", sort: "asc" }
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

export async function fetchIndexVwap(symbol: string, timespan: "minute" | "day" = "minute") {
  const sym = symbol.toUpperCase();
  return latestIndicator(`/v1/indicators/vwap/${sym}`, {
    timespan,
    order: "desc",
    limit: "1",
  });
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

