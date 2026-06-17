import { trackedFetch } from "@/lib/api-tracked-fetch";
import { uwConfigured } from "./config";

const BASE = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
const KEY = process.env.UW_API_KEY ?? "";

async function uwGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  if (!uwConfigured()) throw new Error("UW_API_KEY not set");

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));

  const url = `${BASE}${path}${qs.size ? `?${qs}` : ""}`;
  const res = await trackedFetch("unusual_whales", path, url, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
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
  const data = await uwGetSafe<unknown>(
    `/api/stock/${ticker.toUpperCase()}/implied-volatility-term-structure`,
    {}
  );
  return extractRows(data)
    .map((r) => ({
      expiry: String(r.expiry ?? r.expiration ?? r.date ?? "").slice(0, 10),
      iv: Number(r.iv ?? r.implied_volatility ?? r.volatility ?? 0),
    }))
    .filter((p) => p.expiry && p.iv > 0)
    .slice(0, 8);
}

