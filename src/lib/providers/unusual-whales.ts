import { uwConfigured } from "./config";

const BASE = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
const KEY = process.env.UW_API_KEY ?? "";

async function uwGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  if (!uwConfigured()) throw new Error("UW_API_KEY not set");

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));

  const url = `${BASE}${path}${qs.size ? `?${qs}` : ""}`;
  const res = await fetch(url, {
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

export async function fetchMarketFlowAlerts(params?: {
  limit?: number;
  ticker?: string;
  min_premium?: number;
}): Promise<MarketFlowAlert[]> {
  const query: Record<string, string | number> = {
    limit: Math.min(params?.limit ?? 50, 200),
  };
  if (params?.ticker) query.ticker_symbol = params.ticker.toUpperCase();
  if (params?.min_premium) query.min_premium = params.min_premium;

  const data = await uwGet<unknown>("/api/option-trades/flow-alerts", query);
  return extractRows(data).map(rowToFlow);
}
