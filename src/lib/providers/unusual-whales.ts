import { trackedFetch } from "@/lib/api-tracked-fetch";
import { uwConfigured } from "./config";

const BASE = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
const KEY = process.env.UW_API_KEY ?? "";
const CLIENT_ID = process.env.UW_CLIENT_API_ID ?? "100001";

/** UW Advanced — live options chain, flow, GEX, lit/dark pool, vol analytics, WebSocket streaming. */
export const UW_PLAN_TIER = "advanced" as const;

async function uwGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  if (!uwConfigured()) throw new Error("UW_API_KEY not set");

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));

  const url = `${BASE}${path}${qs.size ? `?${qs}` : ""}`;
  const res = await trackedFetch("unusual_whales", path, url, {
    headers: {
      Authorization: `Bearer ${KEY}`,
      Accept: "application/json",
      "UW-CLIENT-API-ID": CLIENT_ID,
    },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Unusual Whales ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((r) => r && typeof r === "object") as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["data", "flow_alerts", "alerts"]) {
      const block = obj[key];
      if (Array.isArray(block)) return block as Record<string, unknown>[];
    }
  }
  return [];
}

export type MarketFlowAlert = {
  ticker: string;
  premium: number;
  option_type: string;
  expiry: string;
  strike: number;
  direction: string;
  score: number;
  route: string;
  alerted_at: string;
};

function rowToFlow(row: Record<string, unknown>): MarketFlowAlert {
  const opt = String(row.type ?? row.option_type ?? "call").toLowerCase();
  const premium = Number(row.total_premium ?? row.premium ?? 0);
  const dte = row.expiry ? Math.ceil((new Date(String(row.expiry)).getTime() - Date.now()) / 86400000) : 99;
  const route = premium >= 1_000_000 ? "whale" : dte <= 0 ? "0dte" : "stock";

  let alertedAt = String(row.created_at ?? "");
  if (!alertedAt && row.start_time) {
    const ts = Number(row.start_time);
    alertedAt = new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
  }

  return {
    ticker: String(row.ticker ?? "").toUpperCase(),
    premium,
    option_type: opt.startsWith("p") ? "PUT" : "CALL",
    expiry: String(row.expiry ?? "").slice(0, 10),
    strike: Number(row.strike ?? 0),
    direction: opt.startsWith("p") ? "bearish" : "bullish",
    score: Number(row.score ?? 0),
    route,
    alerted_at: alertedAt || new Date().toISOString(),
  };
}

async function uwGetSafe<T>(path: string, params: Record<string, string | number> = {}): Promise<T | null> {
  if (!uwConfigured()) return null;
  try {
    return await uwGet<T>(path, params);
  } catch {
    return null;
  }
}

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function analyzeStrikeGex(rows: Record<string, unknown>[]) {
  let totalCall = 0;
  let totalPut = 0;
  let king: { strike: number; net_gex: number } | null = null;

  for (const row of rows) {
    const strike = Number(row.strike);
    if (!Number.isFinite(strike)) continue;
    const callG = Number(row.call_gamma_oi ?? 0);
    const putG = Number(row.put_gamma_oi ?? 0);
    const net = callG + putG;
    if (!king || Math.abs(net) > Math.abs(king.net_gex)) {
      king = { strike, net_gex: net };
    }
    totalCall += callG;
    totalPut += putG;
  }

  return {
    net_gex: totalCall + totalPut,
    gex_king_strike: king?.strike ?? null,
  };
}

export async function fetchUwOdteGex(ticker = "SPX") {
  const expiry = todayIso();
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker}/spot-exposures/expiry-strike`, {
    "expirations[]": expiry,
    limit: 500,
  });
  const rows = extractRows(data);
  if (!rows.length) return { net_gex: null, gex_king: null, expiry };
  const gex = analyzeStrikeGex(rows);
  return { net_gex: gex.net_gex, gex_king: gex.gex_king_strike, expiry };
}

/** 0DTE strike GEX ladder — same expiry-strike feed, strike-level rows for gamma walls. */
export async function fetchUwOdteSpotExposuresByStrike(ticker = "SPX", limit = 500) {
  const expiry = todayIso();
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker}/spot-exposures/expiry-strike`, {
    "expirations[]": expiry,
    limit,
  });
  return extractRows(data);
}

export async function fetchUwMaxPain(ticker = "SPX") {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker}/max-pain`, {});
  const rows = extractRows(data);
  const today = todayIso();
  let chosen: number | null = null;
  for (const row of rows) {
    const exp = String(row.expiry ?? "").slice(0, 10);
    const strike = Number(row.max_pain ?? 0);
    if (strike <= 0) continue;
    if (exp === today) return strike;
    if (chosen == null) chosen = strike;
  }
  return chosen;
}

export async function fetchUwMarketTide() {
  const data = await uwGetSafe<Record<string, unknown>>("/api/market/market-tide", {
    interval_5m: "false",
  });
  if (!data) return null;
  const block = data.data;
  const row = Array.isArray(block) ? block[block.length - 1] : block;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const call = Number(r.net_call_premium ?? r.call_premium ?? 0);
  const put = Number(r.net_put_premium ?? r.put_premium ?? 0);
  const bias = call > put ? "bullish" : put > call ? "bearish" : "neutral";
  return { call_premium: call, put_premium: put, net: call - put, bias };
}

export async function fetchUwNope(ticker = "SPX") {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker}/nope`, {});
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const block = obj.data;
  const row = Array.isArray(block) ? block[block.length - 1] : block;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return {
    nope: Number(r.nope ?? 0),
    net_delta: Number(r.net_delta ?? 0),
  };
}

export async function fetchUwIvRank(ticker = "SPX") {
  const data = await uwGetSafe<Record<string, unknown>>(`/api/stock/${ticker}/volatility/stats`, {});
  if (!data) return null;
  const block = data.data;
  const row = Array.isArray(block) ? block[0] : block;
  if (!row || typeof row !== "object") return null;
  const ivRank = (row as Record<string, unknown>).iv_rank;
  return ivRank != null ? Number(ivRank) : null;
}

export async function fetchUwFlow0dte(ticker = "SPX") {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker}/flow-per-strike-intraday`, {});
  const rows = extractRows(data);
  let calls = 0;
  let puts = 0;
  for (const row of rows) {
    calls += Number(row.call_premium ?? 0);
    puts += Number(row.put_premium ?? 0);
  }
  return { call_premium: calls, put_premium: puts, net: calls - puts };
}

type MarketFlowRow = { raw: Record<string, unknown>; flow: MarketFlowAlert };

let marketFlowCache: { expiresAt: number; rows: MarketFlowRow[] } | null = null;

function marketFlowCacheMs(): number {
  const sec = Number(process.env.UW_FLOW_ALERTS_CACHE_SEC ?? 15);
  return (Number.isFinite(sec) && sec > 0 ? sec : 15) * 1000;
}

function filterMarketFlowRows(
  rows: MarketFlowRow[],
  params?: { limit?: number; ticker?: string; min_premium?: number }
): MarketFlowRow[] {
  let out = rows;
  if (params?.ticker) {
    const t = params.ticker.toUpperCase();
    out = out.filter((r) => r.flow.ticker === t);
  }
  if (params?.min_premium) {
    out = out.filter((r) => r.flow.premium >= params.min_premium!);
  }
  const limit = Math.min(params?.limit ?? 50, 200);
  return out.slice(0, limit);
}

export async function fetchMarketFlowAlerts(params?: {
  limit?: number;
  ticker?: string;
  min_premium?: number;
  newer_than?: string;
}): Promise<MarketFlowAlert[]> {
  const rows = await fetchMarketFlowAlertRows(params);
  return rows.map((r) => r.flow);
}

export async function fetchMarketFlowAlertRows(params?: {
  limit?: number;
  ticker?: string;
  min_premium?: number;
  newer_than?: string;
}): Promise<MarketFlowRow[]> {
  const now = Date.now();
  const hasFreshCache = marketFlowCache && marketFlowCache.expiresAt > now;

  // Incremental ingest bypasses cache when polling newer_than.
  if (!params?.newer_than && hasFreshCache) {
    return filterMarketFlowRows(marketFlowCache!.rows, params);
  }

  const query: Record<string, string | number> = {
    limit: Math.min(params?.limit ?? 50, 200),
  };
  if (params?.ticker) query.ticker_symbol = params.ticker.toUpperCase();
  if (params?.min_premium) query.min_premium = params.min_premium;
  if (params?.newer_than) query.newer_than = params.newer_than;

  try {
    const data = await uwGet<unknown>("/api/option-trades/flow-alerts", query);
    const rows = extractRows(data).map((raw) => ({ raw, flow: rowToFlow(raw) }));
    if (!params?.newer_than) {
      marketFlowCache = { expiresAt: now + marketFlowCacheMs(), rows };
    }
    return filterMarketFlowRows(rows, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (marketFlowCache) {
      console.warn("[uw] flow-alerts rate limited — serving cache:", message);
      return filterMarketFlowRows(marketFlowCache.rows, params);
    }
    console.warn("[uw] flow-alerts failed:", message);
    return [];
  }
}

export type DarkPoolPrint = {
  strike: number;
  premium: number;
  side: string;
  executed_at: string;
};

export type DarkPoolSnapshot = {
  prints: DarkPoolPrint[];
  total_premium: number;
  call_premium: number;
  put_premium: number;
  bias: string;
  pcr: number | null;
  detail: string;
};

function bucketPrice(price: number, step = 5): number {
  return Math.round(Math.round(price / step) * step * 100) / 100;
}

function darkPoolBias(call: number, put: number, total: number): string {
  if (total <= 0) return "neutral";
  if (call >= total * 0.65) return "bullish";
  if (put >= total * 0.65) return "bearish";
  if (Math.abs(call - put) < total * 0.15) return "mixed";
  return call > put ? "bullish" : "bearish";
}

/** GET /api/darkpool/{ticker} — large institutional prints */
export async function fetchUwDarkPool(
  ticker = "SPX",
  opts?: { limit?: number; min_premium?: number }
): Promise<DarkPoolSnapshot | null> {
  const params: Record<string, string | number> = {
    limit: Math.min(opts?.limit ?? 20, 100),
  };
  if (opts?.min_premium) params.min_premium = opts.min_premium;

  const data = await uwGetSafe<unknown>(`/api/darkpool/${ticker.toUpperCase()}`, params);
  const rows = extractRows(data);
  if (!rows.length) {
    return {
      prints: [],
      total_premium: 0,
      call_premium: 0,
      put_premium: 0,
      bias: "neutral",
      pcr: null,
      detail: "No large dark pool prints today",
    };
  }

  const today = todayIso();
  const prints: DarkPoolPrint[] = [];
  let callPrem = 0;
  let putPrem = 0;
  let total = 0;

  for (const row of rows) {
    const execAt = String(row.executed_at ?? row.date ?? "");
    if (execAt && !execAt.startsWith(today)) continue;

    const premium = Number(row.premium ?? row.size ?? row.notional ?? 0);
    if (premium <= 0) continue;

    const strikeRaw = Number(row.strike ?? row.price ?? row.ref_price ?? 0);
    const strike = Number.isFinite(strikeRaw) ? bucketPrice(strikeRaw) : 0;
    const side = String(row.side ?? row.direction ?? "unknown").toLowerCase();
    const optType = String(row.type ?? row.option_type ?? "").toLowerCase();

    prints.push({
      strike,
      premium,
      side,
      executed_at: execAt.slice(0, 19) || new Date().toISOString(),
    });
    total += premium;
    if (optType.includes("call")) callPrem += premium;
    else if (optType.includes("put")) putPrem += premium;
  }

  const bias = darkPoolBias(callPrem, putPrem, total);
  return {
    prints: prints.slice(0, 20),
    total_premium: total,
    call_premium: callPrem,
    put_premium: putPrem,
    bias,
    pcr: callPrem > 0 ? Math.round((putPrem / callPrem) * 100) / 100 : null,
    detail: prints.length ? `${prints.length} print(s) · $${(total / 1_000_000).toFixed(2)}M` : "No prints today",
  };
}

/** Full strike GEX ladder — GET /api/stock/{t}/spot-exposures/strike */
export async function fetchUwSpotExposuresByStrike(ticker = "SPX", limit = 500) {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker}/spot-exposures/strike`, { limit });
  return extractRows(data);
}

/** Per-ticker flow — GET /api/stock/{t}/flow-alerts */
export async function fetchUwTickerFlowAlerts(ticker = "SPX", limit = 15) {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/flow-alerts`, {
    limit: Math.min(limit, 50),
  });
  return extractRows(data).map((raw) => rowToFlow(raw));
}

export type NetPremTick = { time: string; net: number };

/** Tick-level net premium velocity */
export async function fetchUwNetPremTicks(ticker = "SPY"): Promise<NetPremTick[]> {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/net-prem-ticks`, {});
  const rows = extractRows(data);
  return rows
    .map((r) => ({
      time: String(r.timestamp ?? r.time ?? r.t ?? ""),
      net: Number(r.net_premium ?? r.net ?? r.value ?? 0),
    }))
    .filter((t) => t.time)
    .slice(-40);
}

export type OiChangeItem = {
  strike: number;
  oi_change: number;
  kind: string;
};

/** Intraday OI changes by strike */
export async function fetchUwOiChange(ticker = "SPX"): Promise<OiChangeItem[]> {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/oi-change`, {});
  return extractRows(data)
    .map((r) => ({
      strike: Number(r.strike ?? 0),
      oi_change: Number(r.oi_change ?? r.change ?? r.diff ?? 0),
      kind: String(r.type ?? r.option_type ?? "unknown").toLowerCase(),
    }))
    .filter((r) => r.strike > 0 && r.oi_change !== 0)
    .sort((a, b) => Math.abs(b.oi_change) - Math.abs(a.oi_change))
    .slice(0, 12);
}

export type IvTermPoint = { expiry: string; iv: number };

/** IV term structure curve */
export async function fetchUwIvTermStructure(ticker = "SPX"): Promise<IvTermPoint[]> {
  const sym = ticker.toUpperCase();
  for (const path of [
    `/api/stock/${sym}/volatility/term-structure`,
    `/api/stock/${sym}/implied-volatility-term-structure`,
  ]) {
    const data = await uwGetSafe<unknown>(path, {});
    const rows = extractRows(data)
      .map((r) => ({
        expiry: String(r.expiry ?? r.expiration ?? r.date ?? "").slice(0, 10),
        iv: Number(r.iv ?? r.implied_volatility ?? r.volatility ?? 0),
      }))
      .filter((p) => p.expiry && p.iv > 0)
      .slice(0, 12);
    if (rows.length) return rows;
  }
  return [];
}

export async function fetchUwFlowPerStrikeRows(ticker = "SPX", limit = 30) {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/flow-per-strike-intraday`, {});
  return extractRows(data).slice(0, limit);
}

export async function fetchUwOiPerStrike(ticker = "SPX", limit = 40) {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/oi-per-strike`, { limit });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwGreeksByStrike(ticker: string, expiry?: string, limit = 30) {
  const params: Record<string, string | number> = { limit };
  if (expiry) params.expiry = expiry;
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/greeks`, params);
  return extractRows(data).slice(0, limit);
}

export async function fetchUwSectorTide(sector = "technology") {
  const data = await uwGetSafe<Record<string, unknown>>(`/api/market/${sector.toLowerCase()}/sector-tide`, {});
  if (!data) return null;
  const block = data.data;
  const row = Array.isArray(block) ? block[block.length - 1] : block;
  return row ?? null;
}

export async function fetchUwInsiderFlow(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/insider-buy-sells`, {});
}

export async function fetchUwCongressTrades(ticker?: string, limit = 25) {
  const params: Record<string, string | number> = { limit: Math.min(limit, 100) };
  if (ticker) params.ticker = ticker.toUpperCase();
  return uwGetSafe<unknown>("/api/congress/recent-trades", params);
}

export async function fetchUwShortFloat(ticker: string) {
  return uwGetSafe<unknown>(`/api/shorts/${ticker.toUpperCase()}/interest-float/v2`, {});
}

export async function fetchUwShortScreener(limit = 15) {
  const data = await uwGetSafe<unknown>("/api/shorts/screener", { limit: Math.min(limit, 50) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwFlowPerExpiry(ticker: string, limit = 12) {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/flow-per-expiry`, {});
  return extractRows(data).slice(0, limit);
}

export async function fetchUwStockInfo(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/info`, {});
}

export async function fetchUwEarnings(ticker: string) {
  const sym = ticker.toUpperCase();
  for (const path of [`/api/earnings/${sym}`, `/api/stock/${sym}/earnings`]) {
    const data = await uwGetSafe<unknown>(path, {});
    const rows = extractRows(data);
    if (rows.length) return rows;
  }
  return [];
}

export async function fetchUwScreenerStocks(limit = 15) {
  const data = await uwGetSafe<unknown>("/api/screener/stocks", { limit: Math.min(limit, 50) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwUnusualTrades(ticker?: string, limit = 20) {
  const params: Record<string, string | number> = { limit: Math.min(limit, 100) };
  const data = await uwGetSafe<unknown>("/api/unusual-trades/recent", params);
  let rows = extractRows(data);
  if (ticker) {
    const t = ticker.toUpperCase();
    rows = rows.filter((r) => String(r.ticker ?? "").toUpperCase() === t);
  }
  return rows.slice(0, limit);
}

export async function fetchUwNewsHeadlines(ticker: string, limit = 12) {
  const data = await uwGetSafe<unknown>("/api/news/headlines", {
    ticker: ticker.toUpperCase(),
    limit: Math.min(limit, 50),
  });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwMarketMovers(limit = 15) {
  const data = await uwGetSafe<unknown>("/api/market/movers", { limit: Math.min(limit, 50) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwMarketTopNetImpact(limit = 15) {
  const data = await uwGetSafe<unknown>("/api/market/top-net-impact", { limit: Math.min(limit, 50) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwMarketOiChange(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/market/oi-change", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwAtmChains(ticker: string, expiry?: string, limit = 30) {
  const params: Record<string, string | number> = { limit };
  if (expiry) params.expiry = expiry;
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/atm-chains`, params);
  return extractRows(data).slice(0, limit);
}

export async function fetchUwOiPerExpiry(ticker: string, limit = 12) {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/oi-per-expiry`, {});
  return extractRows(data).slice(0, limit);
}

export async function fetchUwOptionsVolume(ticker: string, limit = 20) {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/options-volume`, {});
  return extractRows(data).slice(0, limit);
}

export async function fetchUwEtfInOutflow(etf: string) {
  return uwGetSafe<unknown>(`/api/etf/${etf.toUpperCase()}/in-outflow`, {});
}

export async function fetchUwEtfTide(etf: string) {
  return uwGetSafe<unknown>(`/api/etf/${etf.toUpperCase()}/tide`, {});
}

export async function fetchUwLitFlow(ticker: string, limit = 20) {
  const data = await uwGetSafe<unknown>("/api/lit-flow/ticker", {
    ticker: ticker.toUpperCase(),
    limit: Math.min(limit, 50),
  });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwScreenerContracts(limit = 20) {
  const data = await uwGetSafe<unknown>("/api/screener/contracts", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwSeasonality(ticker: string) {
  const data = await uwGetSafe<unknown>(`/api/seasonality/${ticker.toUpperCase()}/monthly`, {});
  return extractRows(data);
}

export async function fetchUwCongressLateReports(limit = 20) {
  const data = await uwGetSafe<unknown>("/api/congress/late-reports", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwShortVolume(ticker: string, limit = 15) {
  const data = await uwGetSafe<unknown>(`/api/shorts/${ticker.toUpperCase()}/volume-and-ratio`, {});
  return extractRows(data).slice(0, limit);
}

export async function fetchUwFtds(ticker: string, limit = 15) {
  const data = await uwGetSafe<unknown>(`/api/shorts/${ticker.toUpperCase()}/ftds`, {});
  return extractRows(data).slice(0, limit);
}

export async function fetchUwVolatilityAnomaly(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/volatility/anomaly`, {});
}

export async function fetchUwVolatilityCharacter(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/volatility/character`, {});
}

export async function fetchUwRealizedVol(ticker: string, limit = 15) {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/volatility/realized`, {});
  return extractRows(data).slice(0, limit);
}

export async function fetchUwRiskReversalSkew(ticker: string, limit = 15) {
  const data = await uwGetSafe<unknown>(
    `/api/stock/${ticker.toUpperCase()}/historical-risk-reversal-skew`,
    {}
  );
  return extractRows(data).slice(0, limit);
}

export async function fetchUwVolAnomalyTop(direction = "long_vol", limit = 20) {
  const data = await uwGetSafe<unknown>("/api/volatility/anomaly/top", {
    direction,
    limit: String(Math.min(limit, 50)),
  });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwInsiderTransactions(ticker: string, limit = 15) {
  const data = await uwGetSafe<unknown>("/api/insider/transactions", {
    ticker: ticker.toUpperCase(),
    limit: Math.min(limit, 50),
  });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwFdaCalendar(ticker: string, limit = 10) {
  const data = await uwGetSafe<unknown>("/api/market/fda-calendar", {
    ticker: ticker.toUpperCase(),
    limit: Math.min(limit, 20),
  });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwEarningsEstimates(ticker: string) {
  const data = await uwGetSafe<unknown>(`/api/companies/${ticker.toUpperCase()}/earnings-estimates`, {});
  return extractRows(data);
}

export async function fetchUwOptionContractFlow(contractId: string, limit = 20) {
  const data = await uwGetSafe<unknown>(`/api/option-contract/${contractId.toUpperCase()}/flow`, {
    limit: Math.min(limit, 50),
  });
  return extractRows(data).slice(0, limit);
}

/** Live NBBO options chain — UW Advanced (real-time). Cross-check with Polygon Options Advanced. */
export async function fetchUwOptionContracts(
  ticker: string,
  opts?: { expiry?: string; option_type?: string; limit?: number }
) {
  const params: Record<string, string | number> = { limit: Math.min(opts?.limit ?? 250, 500) };
  if (opts?.expiry) params.expiry = opts.expiry;
  if (opts?.option_type) params.option_type = opts.option_type;
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/option-contracts`, params);
  return extractRows(data);
}

/** Recent ticker flow prints — complements flow-alerts for per-ticker tape. */
export async function fetchUwFlowRecent(ticker: string, limit = 25) {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/flow-recent`, {
    limit: Math.min(limit, 100),
  });
  return extractRows(data).slice(0, limit);
}

/** Interpolated IV + percentile for a ticker. */
export async function fetchUwInterpolatedIv(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/interpolated-iv`, {});
}

/** Static GEX by strike (vs spot-exposures which is interpolated). */
export async function fetchUwGreekExposureStrike(ticker: string, limit = 500) {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/greek-exposure/strike`, {
    limit: Math.min(limit, 500),
  });
  return extractRows(data);
}

/** Market-wide dark pool prints. */
export async function fetchUwDarkPoolRecent(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/darkpool/recent", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

/** Hottest chains / bullish-bearish option screener. */
export async function fetchUwScreenerOptionContracts(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/screener/option-contracts", { limit: Math.min(limit, 150) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwFinancials(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/financials`, {});
}

export async function fetchUwIncomeStatements(ticker: string, reportType = "quarterly") {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/income-statements`, {
    report_type: reportType,
  });
  return extractRows(data);
}

export async function fetchUwBalanceSheets(ticker: string, reportType = "quarterly") {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/balance-sheets`, {
    report_type: reportType,
  });
  return extractRows(data);
}

export async function fetchUwCashFlows(ticker: string, reportType = "quarterly") {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/cash-flows`, {
    report_type: reportType,
  });
  return extractRows(data);
}

/** UW technical indicators — RSI, MACD, SMA, etc. */
export async function fetchUwTechnicalIndicator(
  ticker: string,
  fn: string,
  opts?: { interval?: string; time_period?: number; series_type?: string }
) {
  const params: Record<string, string | number> = {};
  if (opts?.interval) params.interval = opts.interval;
  if (opts?.time_period) params.time_period = opts.time_period;
  if (opts?.series_type) params.series_type = opts.series_type;
  const data = await uwGetSafe<unknown>(
    `/api/stock/${ticker.toUpperCase()}/technical-indicator/${fn.toLowerCase()}`,
    params
  );
  return extractRows(data);
}

/** Daily IV rank time series. */
export async function fetchUwIvRankSeries(ticker: string, limit = 30) {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/iv-rank`, {});
  return extractRows(data).slice(0, limit);
}

export function formatUwOptionContracts(
  rows: Record<string, unknown>[],
  spot: number,
  optionType?: "call" | "put",
  limit = 28
) {
  const want = optionType?.toLowerCase();
  return rows
    .filter((r) => {
      const type = String(r.type ?? r.option_type ?? r.contract_type ?? "").toLowerCase();
      if (want && !type.startsWith(want.slice(0, 1))) return false;
      return Number(r.strike ?? r.strike_price ?? 0) > 0;
    })
    .sort(
      (a, b) =>
        Math.abs(Number(a.strike ?? a.strike_price ?? 0) - spot) -
        Math.abs(Number(b.strike ?? b.strike_price ?? 0) - spot)
    )
    .slice(0, limit)
    .map((r) => ({
      strike: Number(r.strike ?? r.strike_price ?? 0),
      type: r.type ?? r.option_type ?? r.contract_type,
      expiry: String(r.expiry ?? r.expiration ?? r.expiration_date ?? "").slice(0, 10),
      oi: Number(r.open_interest ?? r.oi ?? 0),
      iv: Number(r.implied_volatility ?? r.iv ?? 0),
      delta: Number(r.delta ?? 0),
      gamma: Number(r.gamma ?? 0),
      bid: Number(r.nbbo_bid ?? r.bid ?? 0),
      ask: Number(r.nbbo_ask ?? r.ask ?? 0),
      volume: Number(r.volume ?? 0),
    }));
}

export function uwOptionsMeta() {
  return { data_delay: "real-time", source: "unusual_whales_advanced", plan: UW_PLAN_TIER };
}

function sym(ticker: string) {
  return ticker.toUpperCase().replace(/^I:/, "");
}

export async function fetchUwGexLevels(ticker: string, limit = 500) {
  const data = await uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/gex-levels`, { limit: Math.min(limit, 500) });
  return extractRows(data);
}

export async function fetchUwGreekFlow(ticker: string, expiry?: string, limit = 500) {
  const s = sym(ticker);
  const path = expiry
    ? `/api/stock/${s}/greek-flow/${expiry}`
    : `/api/stock/${s}/greek-flow`;
  const data = await uwGetSafe<unknown>(path, { limit: Math.min(limit, 500) });
  return extractRows(data);
}

export async function fetchUwSpotExposuresExpiryStrike(
  ticker: string,
  expiry: string,
  limit = 500
) {
  const data = await uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/spot-exposures/expiry-strike`, {
    "expirations[]": expiry,
    limit: Math.min(limit, 500),
  });
  return extractRows(data);
}

export async function fetchUwSpotExposuresByExpiry(ticker: string, expiry: string, limit = 500) {
  const data = await uwGetSafe<unknown>(
    `/api/stock/${sym(ticker)}/spot-exposures/${expiry}/strike`,
    { limit: Math.min(limit, 500) }
  );
  return extractRows(data);
}

export async function fetchUwGreekExposureExpiry(ticker: string, limit = 500) {
  const data = await uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/greek-exposure/expiry`, {
    limit: Math.min(limit, 500),
  });
  return extractRows(data);
}

export async function fetchUwStockState(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/stock-state`, {});
}

export async function fetchUwFlowPerStrike(ticker: string, limit = 40) {
  const data = await uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/flow-per-strike`, { limit });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwLitFlowRecent(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/lit-flow/recent", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwMarketTotalOptionsVolume() {
  return uwGetSafe<unknown>("/api/market/total-options-volume", {});
}

export async function fetchUwMarketCorrelations(limit = 30) {
  const data = await uwGetSafe<unknown>("/api/market/correlations", { limit: Math.min(limit, 100) });
  return extractRows(data);
}

export async function fetchUwMarketEconomicCalendar(limit = 20) {
  const data = await uwGetSafe<unknown>("/api/market/economic-calendar", { limit: Math.min(limit, 50) });
  return extractRows(data);
}

export async function fetchUwVixTermStructure(limit = 20) {
  const data = await uwGetSafe<unknown>("/api/volatility/vix-term-structure", { limit: Math.min(limit, 50) });
  return extractRows(data);
}

export async function fetchUwVolatilityCharacterTop(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/volatility/character/top", { limit: Math.min(limit, 50) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwVarianceRiskPremium(ticker: string, limit = 30) {
  const data = await uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/volatility/variance-risk-premium`, {});
  return extractRows(data).slice(0, limit);
}

export async function fetchUwEarningsPremarket(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/earnings/premarket", { limit: Math.min(limit, 50) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwEarningsAfterhours(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/earnings/afterhours", { limit: Math.min(limit, 50) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwOptionChains(ticker: string, limit = 500) {
  const data = await uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/option-chains`, { limit: Math.min(limit, 500) });
  return extractRows(data);
}

export async function fetchUwOwnership(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/ownership`, {});
}

export async function fetchUwOhlc(ticker: string, candleSize = "1d", limit = 60) {
  const data = await uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/ohlc/${candleSize}`, {
    limit: Math.min(limit, 500),
  });
  return extractRows(data);
}

export async function fetchUwOptionContractIntraday(contractId: string, limit = 30) {
  const data = await uwGetSafe<unknown>(`/api/option-contract/${contractId.toUpperCase()}/intraday`, {
    limit: Math.min(limit, 100),
  });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwOptionContractVolumeProfile(contractId: string) {
  return uwGetSafe<unknown>(`/api/option-contract/${contractId.toUpperCase()}/volume-profile`, {});
}

export async function fetchUwInsiderTicker(ticker: string, limit = 25) {
  const data = await uwGetSafe<unknown>(`/api/insider/${sym(ticker)}`, { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwInsiderSectorFlow(sector: string, limit = 25) {
  const data = await uwGetSafe<unknown>(`/api/insider/${sector.toLowerCase()}/sector-flow`, {
    limit: Math.min(limit, 100),
  });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwCongressUnusualTrades(ticker?: string, limit = 25) {
  const params: Record<string, string | number> = { limit: Math.min(limit, 100) };
  if (ticker) params.ticker = sym(ticker);
  const data = await uwGetSafe<unknown>("/api/congress/unusual-trades", params);
  return extractRows(data).slice(0, limit);
}

export async function fetchUwCongressPoliticians(limit = 30) {
  const data = await uwGetSafe<unknown>("/api/congress/politicians", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwEtfHoldings(etf: string, limit = 50) {
  const data = await uwGetSafe<unknown>(`/api/etfs/${etf.toUpperCase()}/holdings`, { limit: Math.min(limit, 200) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwEtfExposure(etf: string) {
  return uwGetSafe<unknown>(`/api/etfs/${etf.toUpperCase()}/exposure`, {});
}

export async function fetchUwEtfInfo(etf: string) {
  return uwGetSafe<unknown>(`/api/etfs/${etf.toUpperCase()}/info`, {});
}

export async function fetchUwEtfWeights(etf: string, limit = 50) {
  const data = await uwGetSafe<unknown>(`/api/etfs/${etf.toUpperCase()}/weights`, { limit: Math.min(limit, 200) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwInstitutionActivity(name: string, limit = 30) {
  const data = await uwGetSafe<unknown>(`/api/institution/${encodeURIComponent(name)}/activity`, {
    limit: Math.min(limit, 100),
  });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwInstitutionHoldings(name: string, limit = 30) {
  const data = await uwGetSafe<unknown>(`/api/institution/${encodeURIComponent(name)}/holdings`, {
    limit: Math.min(limit, 100),
  });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwInstitutionsLatestFilings(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/institutions/latest_filings", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwInstitutionOwnership(ticker: string, limit = 30) {
  const data = await uwGetSafe<unknown>(`/api/institution/${sym(ticker)}/ownership`, { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwNetFlowExpiry(limit = 30) {
  const data = await uwGetSafe<unknown>("/api/net-flow/expiry", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwCompaniesDividends(ticker: string, limit = 20) {
  const data = await uwGetSafe<unknown>(`/api/companies/${sym(ticker)}/dividends`, { limit: Math.min(limit, 50) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwCompaniesSplits(ticker: string, limit = 20) {
  const data = await uwGetSafe<unknown>(`/api/companies/${sym(ticker)}/splits`, { limit: Math.min(limit, 50) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwCompaniesProfile(ticker: string) {
  return uwGetSafe<unknown>(`/api/companies/${sym(ticker)}/profile`, {});
}

export async function fetchUwSeasonalityMarket() {
  return uwGetSafe<unknown>("/api/seasonality/market", {});
}

export async function fetchUwMarketSectorEtfs() {
  return uwGetSafe<unknown>("/api/market/sector-etfs", {});
}

export async function fetchUwScreenerAnalysts(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/screener/analysts", { limit: Math.min(limit, 50) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwShortsData(ticker: string) {
  return uwGetSafe<unknown>(`/api/shorts/${sym(ticker)}/data`, {});
}

export async function fetchUwShortVolumesByExchange(ticker: string, limit = 15) {
  const data = await uwGetSafe<unknown>(`/api/shorts/${sym(ticker)}/volumes-by-exchange`, {});
  return extractRows(data).slice(0, limit);
}

export async function fetchUwFundamentalBreakdown(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/fundamental-breakdown`, {});
}

export async function fetchUwExpiryBreakdown(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/expiry-breakdown`, {});
}

export async function fetchUwOptionVolumeOiExpiry(ticker: string, limit = 30) {
  const data = await uwGetSafe<unknown>(`/api/stock/${sym(ticker)}/option/volume-oi-expiry`, {
    limit: Math.min(limit, 100),
  });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwGlobalFlowAlerts(limit = 30, params?: Record<string, string | number>) {
  const data = await uwGetSafe<unknown>("/api/option-trades/flow-alerts", {
    limit: Math.min(limit, 200),
    ...params,
  });
  return extractRows(data).slice(0, limit);
}
