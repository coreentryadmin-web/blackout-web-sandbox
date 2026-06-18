import { polygonConfigured } from "./config";
import { todayEtYmd } from "./spx-session";
import { trackedFetch } from "@/lib/api-tracked-fetch";

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = process.env.POLYGON_API_KEY ?? "";

/** Options Advanced plan: chain snapshots, greeks, and quotes are real-time. */
export const POLYGON_OPTIONS_DATA_DELAY = "real-time (Massive Options Advanced plan)";

export function polygonOptionsMeta() {
  return { data_delay: POLYGON_OPTIONS_DATA_DELAY, source: "polygon", plan: "options_advanced" };
}

type ChainContract = {
  details?: {
    strike_price?: number;
    contract_type?: string;
    expiration_date?: string;
  };
  greeks?: { gamma?: number };
  open_interest?: number;
  underlying_asset?: { price?: number };
};

type ChainResponse = {
  results?: ChainContract[];
  next_url?: string;
  status?: string;
};

let cachedOdteBundle: {
  at: number;
  spot: number;
  rows: Record<string, unknown>[];
  maxPain: number | null;
} | null = null;

function polygonGexCacheMs(): number {
  const sec = Number(process.env.SPX_POLYGON_GEX_CACHE_SEC ?? 15);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 15_000;
}

async function loadOdteContracts(spot: number, expiry: string): Promise<ChainContract[]> {
  const [spx, spxw] = await Promise.all([
    fetchChainBand("SPX", spot, expiry),
    fetchChainBand("SPXW", spot, expiry),
  ]);
  return [...spx, ...spxw];
}

/** 0DTE GEX rows + max pain from one Polygon chain snapshot (SPX + SPXW). */
export async function fetchPolygonOdteDeskBundle(
  spot: number,
  expiry = todayEtYmd()
): Promise<{ rows: Record<string, unknown>[]; maxPain: number | null }> {
  if (!polygonConfigured() || spot <= 0) return { rows: [], maxPain: null };

  const now = Date.now();
  if (
    cachedOdteBundle &&
    now - cachedOdteBundle.at < polygonGexCacheMs() &&
    Math.abs(cachedOdteBundle.spot - spot) < Math.max(spot * 0.003, 5)
  ) {
    return { rows: cachedOdteBundle.rows, maxPain: cachedOdteBundle.maxPain };
  }

  const contracts = await loadOdteContracts(spot, expiry);
  const rows = aggregateGexRows(contracts, spot);
  const maxPain = computeMaxPainFromChain(contracts);
  if (rows.length) {
    cachedOdteBundle = { at: now, spot, rows, maxPain };
  }
  return { rows, maxPain };
}

async function polygonFetchUrl(url: string): Promise<ChainResponse | null> {
  if (!polygonConfigured()) return null;
  const sep = url.includes("?") ? "&" : "?";
  const full = url.startsWith("http")
    ? `${url}${sep}apiKey=${KEY}`
    : `${BASE}${url}${sep}apiKey=${KEY}`;
  const endpointKey = url.startsWith("http")
    ? "/v3/snapshot/options/{underlying}"
    : url.split("?")[0] || "/v3/snapshot/options/{underlying}";
  try {
    const res = await trackedFetch("polygon", endpointKey, full, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as ChainResponse;
  } catch {
    return null;
  }
}

async function fetchChainBand(
  underlying: string,
  spot: number,
  expiry: string
): Promise<ChainContract[]> {
  const band = Math.max(spot * 0.015, 80);
  const lo = Math.floor(spot - band);
  const hi = Math.ceil(spot + band);

  const params = new URLSearchParams({
    expiration_date: expiry,
    "strike_price.gte": String(lo),
    "strike_price.lte": String(hi),
    limit: "250",
    apiKey: KEY,
  });

  const out: ChainContract[] = [];
  let page = await polygonFetchUrl(`/v3/snapshot/options/${underlying}?${params}`);
  let guard = 0;

  while (page && guard < 8) {
    out.push(...(page.results ?? []));
    if (!page.next_url) break;
    page = await polygonFetchUrl(page.next_url);
    guard += 1;
  }

  return out;
}

export function summarizeGexFromChain(contracts: ChainContract[], spot: number) {
  return aggregateGexRows(contracts, spot);
}

function aggregateGexRows(contracts: ChainContract[], spot: number): Record<string, unknown>[] {
  const byStrike = new Map<number, { call: number; put: number }>();

  for (const c of contracts) {
    const strike = Number(c.details?.strike_price);
    const gamma = Number(c.greeks?.gamma ?? 0);
    const oi = Number(c.open_interest ?? 0);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    if (!Number.isFinite(strike) || strike <= 0 || !oi || !gamma) continue;

    const contrib = gamma * oi * 100 * spot;
    const row = byStrike.get(strike) ?? { call: 0, put: 0 };
    if (type === "call") row.call += contrib;
    else if (type === "put") row.put -= contrib;
    byStrike.set(strike, row);
  }

  return Array.from(byStrike.entries()).map(([strike, g]) => ({
    strike,
    call_gamma_oi: g.call,
    put_gamma_oi: g.put,
  }));
}

/** 0DTE GEX strike rows from Polygon chain snapshot (SPX + SPXW). UW fallback if empty. */
export async function fetchPolygonOdteGexRows(
  spot: number,
  expiry = todayEtYmd()
): Promise<Record<string, unknown>[]> {
  const { rows } = await fetchPolygonOdteDeskBundle(spot, expiry);
  return rows;
}

/** Options chain near the money for Largo terminal tools. */
export async function fetchPolygonOptionsChain(
  underlying: string,
  spot: number,
  expiry: string
): Promise<ChainContract[]> {
  if (!polygonConfigured() || spot <= 0) return [];
  const root = underlying.toUpperCase();
  if (root === "SPX") {
    const [spx, spxw] = await Promise.all([
      fetchChainBand("SPX", spot, expiry),
      fetchChainBand("SPXW", spot, expiry),
    ]);
    return [...spx, ...spxw];
  }
  return fetchChainBand(root, spot, expiry);
}

export function summarizeOiByStrike(contracts: ChainContract[], limit = 20) {
  const byStrike = new Map<number, { call_oi: number; put_oi: number }>();
  for (const c of contracts) {
    const strike = Number(c.details?.strike_price);
    const oi = Number(c.open_interest ?? 0);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    if (!Number.isFinite(strike) || strike <= 0 || !oi) continue;
    const row = byStrike.get(strike) ?? { call_oi: 0, put_oi: 0 };
    if (type === "call") row.call_oi += oi;
    else if (type === "put") row.put_oi += oi;
    byStrike.set(strike, row);
  }
  return Array.from(byStrike.entries())
    .map(([strike, oi]) => ({ strike, ...oi, total_oi: oi.call_oi + oi.put_oi }))
    .sort((a, b) => b.total_oi - a.total_oi)
    .slice(0, limit);
}

export function computeMaxPainFromChain(contracts: ChainContract[]): number | null {
  const byStrike = summarizeOiByStrike(contracts, 500);
  if (!byStrike.length) return null;
  let bestStrike: number | null = null;
  let bestPain = Infinity;
  for (const candidate of byStrike) {
    let pain = 0;
    for (const row of byStrike) {
      if (row.strike < candidate.strike) pain += (candidate.strike - row.strike) * row.call_oi;
      if (row.strike > candidate.strike) pain += (row.strike - candidate.strike) * row.put_oi;
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = candidate.strike;
    }
  }
  return bestStrike;
}

export function formatChainContracts(
  contracts: ChainContract[],
  spot: number,
  optionType?: "call" | "put",
  limit = 24
) {
  const want = optionType?.toLowerCase();
  return contracts
    .filter((c) => {
      const type = String(c.details?.contract_type ?? "").toLowerCase();
      if (want && type !== want) return false;
      return Number(c.details?.strike_price) > 0;
    })
    .sort(
      (a, b) =>
        Math.abs(Number(a.details?.strike_price) - spot) -
        Math.abs(Number(b.details?.strike_price) - spot)
    )
    .slice(0, limit)
    .map((c) => ({
      strike: Number(c.details?.strike_price),
      type: c.details?.contract_type,
      expiry: c.details?.expiration_date,
      oi: Number(c.open_interest ?? 0),
      iv: Number((c as { implied_volatility?: number }).implied_volatility ?? 0),
      delta: Number((c as { greeks?: { delta?: number } }).greeks?.delta ?? 0),
      gamma: Number(c.greeks?.gamma ?? 0),
      bid: Number((c as { last_quote?: { bid?: number } }).last_quote?.bid ?? 0),
      ask: Number((c as { last_quote?: { ask?: number } }).last_quote?.ask ?? 0),
    }));
}
