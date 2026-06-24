import { polygonConfigured } from "./config";
import { fetchStockSnapshot } from "./polygon";
import { todayEtYmd } from "./spx-session";
import { polygonTrackedFetch } from "./polygon-rate-limiter";

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = process.env.POLYGON_API_KEY ?? "";

/** Hostname only (never the apiKey query string) for safe diagnostic logging. */
function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return "?"; }
}

/** Options Advanced plan: chain snapshots, greeks, and quotes are real-time. */
export const POLYGON_OPTIONS_DATA_DELAY = "real-time (Massive Options Advanced plan)";

export function polygonOptionsMeta() {
  return { data_delay: POLYGON_OPTIONS_DATA_DELAY, source: "polygon", plan: "options_advanced" };
}

export type ChainContract = {
  details?: {
    strike_price?: number;
    contract_type?: string;
    expiration_date?: string;
  };
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
  implied_volatility?: number;
  open_interest?: number;
  last_quote?: { bid?: number; ask?: number };
  last_trade?: { price?: number };
  day?: { close?: number };
  underlying_asset?: { price?: number };
};

/**
 * Night's Watch chain fetch — the BATCHABLE valuation primitive. Returns a band of
 * contracts around spot for an underlying + expiry, plus the spot, so the caller can
 * match every saved strike for that (underlying, expiry) IN-MEMORY from a single call.
 *
 * This is intentionally NOT per-contract: it is wrapped by getNwChain() in
 * lib/nights-watch/chain-cache.ts with withServerCache, so 500 users holding contracts
 * on the same (underlying, expiry) collapse to ONE upstream fetch per TTL window.
 * Returns null when not configured or spot is unavailable — never fabricates.
 * (A future optimization can swap to /v3/snapshot/options/{underlying}/{contract}.)
 */
export async function fetchNwOptionChain(
  underlying: string,
  expiry: string, // YYYY-MM-DD
  bandPct = 0.35
): Promise<{ contracts: ChainContract[]; spot: number } | null> {
  if (!polygonConfigured()) return null;
  const root = underlying.toUpperCase();
  const underlyingRoot = root === "SPX" ? "I:SPX" : root;

  const snap = await fetchStockSnapshot(underlyingRoot).catch(() => null);
  const spot = snap?.price ?? 0;
  if (!(spot > 0)) return null; // no spot → can't center a band; report unavailable

  const contracts = await fetchChainBand(underlyingRoot, spot, expiry, bandPct);
  if (!contracts.length) return null;
  return { contracts, spot };
}

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

const POLYGON_ODTE_CACHE_KEY = "polygon:odte_gex_bundle";

/**
 * Ring buffer of recent SPX spot prices used to detect fast moves.
 * Each entry is { price, at } where `at` is epoch-ms.
 */
const spxPriceHistory: Array<{ price: number; at: number }> = [];
const SPX_HISTORY_WINDOW_MS = 5 * 60_000; // 5 minutes

/** Record a new SPX spot price observation for volatility detection. */
export function recordSpxPriceObservation(price: number): void {
  const now = Date.now();
  spxPriceHistory.push({ price, at: now });
  // Purge entries older than the window to keep the buffer small.
  const cutoff = now - SPX_HISTORY_WINDOW_MS;
  while (spxPriceHistory.length > 0 && spxPriceHistory[0].at < cutoff) {
    spxPriceHistory.shift();
  }
}

/**
 * Returns true if SPX has moved more than 0.5% in the last 5 minutes,
 * indicating a fast-move / volatile market condition.
 */
function isSpxFastMove(currentSpot: number): boolean {
  if (spxPriceHistory.length === 0) return false;
  const oldest = spxPriceHistory[0].price;
  if (oldest <= 0) return false;
  return Math.abs(currentSpot - oldest) / oldest > 0.005;
}

function polygonGexCacheMs(): number {
  const sec = Number(process.env.SPX_POLYGON_GEX_CACHE_SEC ?? 15);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 15_000;
}

async function loadOdteContracts(spot: number, expiry: string): Promise<ChainContract[]> {
  // SPX index options (both the SPX monthly and SPXW weekly roots) are listed under
  // the index underlying I:SPX on Polygon/Massive. A bare "SPX"/"SPXW" underlying
  // returns HTTP 200 with ZERO results — which is why GEX walls were always empty.
  return fetchChainBand("I:SPX", spot, expiry);
}

/** 0DTE GEX rows + max pain from one Polygon chain snapshot (SPX + SPXW). */
export async function fetchPolygonOdteDeskBundle(
  spot: number,
  expiry = todayEtYmd(),
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
): Promise<{ rows: Record<string, unknown>[]; maxPain: number | null }> {
  if (!polygonConfigured() || spot <= 0) return { rows: [], maxPain: null };

  // Feed the fast-move ring buffer on every desk GEX fetch so isSpxFastMove can actually
  // fire — without this call spxPriceHistory stays empty and the fast-move cache bypass
  // below is dead code (GEX walls served stale during the exact move they matter for).
  recordSpxPriceObservation(spot);

  const now = Date.now();
  // During fast moves (SPX >0.5% in the last 5 min) bypass cache entirely so
  // GEX reflects the new price level. Also bypass when callers set forceRefresh.
  const fastMove = isSpxFastMove(spot);
  const skipCache = forceRefresh || fastMove;

  if (
    !skipCache &&
    cachedOdteBundle &&
    now - cachedOdteBundle.at < polygonGexCacheMs() &&
    Math.abs(cachedOdteBundle.spot - spot) < Math.max(spot * 0.003, 5)
  ) {
    return { rows: cachedOdteBundle.rows, maxPain: cachedOdteBundle.maxPain };
  }

  try {
    const { sharedCacheGet } = await import("../shared-cache");
    const redisHit = await sharedCacheGet<{
      at: number;
      spot: number;
      rows: Record<string, unknown>[];
      maxPain: number | null;
    }>(POLYGON_ODTE_CACHE_KEY);
    if (
      !skipCache &&
      redisHit &&
      now - redisHit.at < polygonGexCacheMs() &&
      Math.abs(redisHit.spot - spot) < Math.max(spot * 0.003, 5)
    ) {
      cachedOdteBundle = redisHit;
      return { rows: redisHit.rows, maxPain: redisHit.maxPain };
    }
  } catch {
    /* redis optional */
  }

  const contracts = await loadOdteContracts(spot, expiry);
  if (!contracts.length) {
    console.warn(`[polygon-gex] 0 I:SPX contracts for ${expiry} @ ${spot} via ${hostOf(BASE)} — GEX walls will be empty. Verify POLYGON_API_KEY is a valid ${hostOf(BASE)} key with options-chain access (set POLYGON_API_BASE if your key is from a different provider, e.g. https://api.polygon.io).`);
  }
  const rows = aggregateGexRows(contracts, spot);
  const maxPain = computeMaxPainFromChain(contracts);
  if (rows.length) {
    cachedOdteBundle = { at: now, spot, rows, maxPain };
    void import("../shared-cache").then(({ sharedCacheSet }) =>
      sharedCacheSet(POLYGON_ODTE_CACHE_KEY, cachedOdteBundle, Math.ceil(polygonGexCacheMs() / 1000))
    );
  }
  return { rows, maxPain };
}

// ---------------------------------------------------------------------------
// GEX Heatmap — dealer gamma matrix (strike rows × expiry columns)
// ---------------------------------------------------------------------------

export type GexHeatmap = {
  underlying: string;
  spot: number;
  change_pct: number;
  asof: string;
  /** Ascending, ~8 nearest expirations present in the band. */
  expiries: string[];
  /** Descending, strike-banded around spot. */
  strikes: number[];
  /** Net dealer dollar-gamma per (strike, expiry). Sparse — absent = no data. */
  cells: Record<string, Record<string, number>>;
  /** Net dealer dollar-gamma summed across all expiries, per strike. */
  strike_totals: Record<string, number>;
  /** Linear-interpolated zero-gamma flip strike, or null when undetermined. */
  zero_gamma_flip: number | null;
  /** Strike with the LARGEST POSITIVE net dealer gamma (dealer long-gamma → resistance/pin), or null. */
  call_wall: number | null;
  /** Strike with the LARGEST NEGATIVE net dealer gamma (support), or null. */
  put_wall: number | null;
  /** Max-pain strike (option-holder value minimizer), or null when not feasible. */
  max_pain: number | null;
  /** Regime read derived from spot vs the gamma flip. */
  regime: GexRegime;
  /** Total net dealer dollar-gamma across the whole matrix. */
  total_gex: number;
  source: "polygon";
  data_delay: string;
};

export type GexRegime = {
  /** The gamma flip the posture is measured against (mirrors zero_gamma_flip), or null. */
  flip: number | null;
  /** 'long' when spot is at/above the flip, 'short' when below, null when undetermined. */
  posture: "long" | "short" | null;
  /** Computed one-liner describing the regime — neutral string when data is missing. */
  read: string;
};

/**
 * Derive the dealer-gamma regime levels (call wall, put wall, posture, read) from the
 * already-computed per-strike NET gamma totals + spot + flip. Never fabricates: when a
 * level can't be determined it is null and the `read` falls back to a neutral string.
 */
function computeGexRegime(
  strikeTotals: Record<string, number>,
  spot: number,
  flip: number | null,
  maxPain: number | null
): { callWall: number | null; putWall: number | null; regime: GexRegime } {
  let callWall: number | null = null;
  let putWall: number | null = null;
  let maxPos = 0;
  let maxNeg = 0;
  for (const [s, g] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    // Largest POSITIVE net gamma → call wall (resistance/pin).
    if (g > maxPos) {
      maxPos = g;
      callWall = strike;
    }
    // Largest NEGATIVE net gamma → put wall (support).
    if (g < maxNeg) {
      maxNeg = g;
      putWall = strike;
    }
  }

  const posture: "long" | "short" | null =
    flip != null && spot > 0 ? (spot >= flip ? "long" : "short") : null;

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  let read: string;
  if (posture == null || flip == null || !(spot > 0)) {
    read = "Gamma flip undetermined — regime read unavailable until the chain prints a clean dealer-gamma profile.";
  } else if (posture === "long") {
    const resistance = callWall != null ? ` Resistance ${fmt(callWall)}` : "";
    const support = putWall != null ? `${resistance ? "," : ""} support ${fmt(putWall)}` : "";
    const tail = resistance || support ? `.${resistance}${support}.` : ".";
    read = `Spot ${fmt(spot)} is above the gamma flip (${fmt(flip)}) → long gamma: range-bound, fade extremes${tail}`;
  } else {
    const resistance = callWall != null ? ` Resistance ${fmt(callWall)}` : "";
    const support = putWall != null ? `${resistance ? "," : ""} support ${fmt(putWall)}` : "";
    const tail = resistance || support ? `.${resistance}${support}.` : ".";
    read = `Spot ${fmt(spot)} is below the gamma flip (${fmt(flip)}) → short gamma: momentum / vol expansion, moves accelerate${tail}`;
  }

  // Note: maxPain is surfaced as its own field; intentionally not folded into `read`.
  void maxPain;

  return { callWall, putWall, regime: { flip, posture, read } };
}

const GEX_HEATMAP_CACHE_PREFIX = "gex-heatmap";
/** In-memory mirror of the Redis matrix so co-located requests skip Redis too. */
const cachedHeatmaps = new Map<string, { at: number; data: GexHeatmap }>();

function gexHeatmapCacheMs(): number {
  const sec = Number(process.env.GEX_HEATMAP_CACHE_SEC ?? 45);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 45_000;
}

/**
 * Strike-banded options chain snapshot across ALL expiries in one paginated pass
 * (NO expiration_date filter — the snapshot returns every expiry inside the strike
 * window). Reuses polygonFetchUrl + the next_url pagination exactly like fetchChainBand.
 */
async function fetchHeatmapBand(
  underlying: string,
  spot: number,
  bandPct: number
): Promise<ChainContract[]> {
  const band = Math.max(spot * bandPct, 1);
  const lo = Math.floor(spot - band);
  const hi = Math.ceil(spot + band);

  const params = new URLSearchParams({
    "strike_price.gte": String(lo),
    "strike_price.lte": String(hi),
    limit: "250",
    apiKey: KEY,
  });

  const out: ChainContract[] = [];
  let page = await polygonFetchUrl(`/v3/snapshot/options/${underlying}?${params}`);
  // ~8 expiries × banded strikes × calls+puts can exceed one page; allow generous paging.
  let guard = 0;
  while (page && guard < 16) {
    out.push(...(page.results ?? []));
    if (!page.next_url) break;
    page = await polygonFetchUrl(page.next_url);
    guard += 1;
  }
  return out;
}

/**
 * Compute the zero-gamma flip from per-strike NET dealer gamma totals: the strike
 * where cumulative dealer gamma (ascending by strike) crosses zero. Linear-interpolated
 * between the bracketing strikes. Returns null when no sign change is present.
 */
function computeZeroGammaFlip(strikeTotals: Record<string, number>): number | null {
  const rows = Object.entries(strikeTotals)
    .map(([s, g]) => ({ strike: Number(s), gamma: g }))
    .filter((r) => Number.isFinite(r.strike))
    .sort((a, b) => a.strike - b.strike);
  if (rows.length < 2) return null;

  let cumulative = 0;
  let prevStrike = rows[0].strike;
  let prevCum = 0;
  for (let i = 0; i < rows.length; i++) {
    const nextCum = cumulative + rows[i].gamma;
    if (i > 0 && prevCum !== 0 && Math.sign(nextCum) !== Math.sign(prevCum) && nextCum !== 0) {
      // Cross between prevStrike and rows[i].strike — interpolate on cumulative gamma.
      const span = rows[i].strike - prevStrike;
      const frac = prevCum / (prevCum - nextCum); // 0..1
      return Number((prevStrike + span * frac).toFixed(2));
    }
    if (i > 0) {
      prevStrike = rows[i - 1].strike;
      prevCum = cumulative;
    }
    cumulative = nextCum;
  }
  return null;
}

/**
 * Dealer GEX heatmap for `underlying` (default SPY): a (strike × expiry) matrix of
 * NET dealer dollar-gamma, computed ONCE and cached server-side (in-memory + Redis)
 * so 500 concurrent users read one matrix and never trigger a per-user chain fetch.
 *
 * Sign convention MIRRORS aggregateGexRows exactly: per contract dollar gamma is
 * `gamma × open_interest × 100 × spot`; calls add it, puts subtract it. Summed per
 * (strike, expiry) cell → net dealer gamma. On any Polygon failure / empty chain this
 * returns null (never fabricates gamma).
 *
 * NOTE: SPY (equity ETF options) is used by default — listed directly under "SPY".
 * SPX index options live under I:SPX; this fn supports it but the desk GEX walls use
 * SPX, so SPY here gives a liquid, broadly-comparable dealer gamma surface.
 */
export async function fetchGexHeatmap(
  underlying = "SPY",
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
): Promise<GexHeatmap | null> {
  if (!polygonConfigured()) return null;
  const root = underlying.toUpperCase();
  const cacheKey = `${GEX_HEATMAP_CACHE_PREFIX}:${root}`;
  const now = Date.now();
  const ttlMs = gexHeatmapCacheMs();

  if (!forceRefresh) {
    const mem = cachedHeatmaps.get(cacheKey);
    if (mem && now - mem.at < ttlMs) return mem.data;
    try {
      const { sharedCacheGet } = await import("../shared-cache");
      const hit = await sharedCacheGet<{ at: number; data: GexHeatmap }>(cacheKey);
      if (hit && now - hit.at < ttlMs) {
        cachedHeatmaps.set(cacheKey, hit);
        return hit.data;
      }
    } catch {
      /* redis optional */
    }
  }

  // Resolve spot + day change%. SPX index options are listed under I:SPX, but the
  // quote comes from the index snapshot; for equity/ETF roots use the stock snapshot.
  const quoteSym = root === "SPX" ? "I:SPX" : root;
  const snap = await fetchStockSnapshot(quoteSym).catch(() => null);
  const spot = snap?.price ?? 0;
  if (!(spot > 0)) return null;
  const changePct = snap?.change_pct ?? 0;

  const optionsRoot = root === "SPX" ? "I:SPX" : root;
  const contracts = await fetchHeatmapBand(optionsRoot, spot, 0.04);
  if (!contracts.length) {
    console.warn(
      `[gex-heatmap] 0 contracts for ${optionsRoot} @ ${spot} via ${hostOf(BASE)} — heatmap will be empty. Verify POLYGON_API_KEY has options-chain access.`
    );
    return null;
  }

  const today = todayEtYmd();
  // Net dealer gamma per (strike, expiry). Sign convention mirrors aggregateGexRows.
  const cellMap = new Map<number, Map<string, number>>();
  const strikeTotalMap = new Map<number, number>();
  const expirySet = new Set<string>();
  let totalGex = 0;

  for (const c of contracts) {
    const strike = Number(c.details?.strike_price);
    const expiry = String(c.details?.expiration_date ?? "").slice(0, 10);
    const gamma = Number(c.greeks?.gamma ?? 0);
    const oi = Number(c.open_interest ?? 0);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    if (!Number.isFinite(strike) || strike <= 0 || !expiry || expiry < today) continue;
    if (!oi || !gamma) continue; // missing data → skip, never fabricate

    const dollarGamma = gamma * oi * 100 * spot;
    const signed = type === "call" ? dollarGamma : type === "put" ? -dollarGamma : 0;
    if (signed === 0) continue;

    expirySet.add(expiry);
    const byExpiry = cellMap.get(strike) ?? new Map<string, number>();
    byExpiry.set(expiry, (byExpiry.get(expiry) ?? 0) + signed);
    cellMap.set(strike, byExpiry);
    strikeTotalMap.set(strike, (strikeTotalMap.get(strike) ?? 0) + signed);
    totalGex += signed;
  }

  if (expirySet.size === 0) return null;

  // Keep the nearest ~8 expiries (ascending).
  const expiries = Array.from(expirySet).sort().slice(0, 8);
  const expirySetKeep = new Set(expiries);
  // Strikes descending (heatmap rows render high→low like a ladder).
  const strikes = Array.from(cellMap.keys()).sort((a, b) => b - a);

  const cells: Record<string, Record<string, number>> = {};
  const strikeTotals: Record<string, number> = {};
  let prunedTotal = 0;
  for (const strike of strikes) {
    const byExpiry = cellMap.get(strike)!;
    const row: Record<string, number> = {};
    let strikeSum = 0;
    for (const [expiry, val] of Array.from(byExpiry.entries())) {
      if (!expirySetKeep.has(expiry)) continue; // drop the >8th expiry's cells
      row[expiry] = val;
      strikeSum += val;
    }
    if (Object.keys(row).length === 0) continue;
    cells[String(strike)] = row;
    strikeTotals[String(strike)] = strikeSum;
    prunedTotal += strikeSum;
  }

  const finalStrikes = strikes.filter((s) => cells[String(s)] != null);
  const zeroGammaFlip = computeZeroGammaFlip(strikeTotals);

  // Max pain from the same banded chain (option-holder value minimizer). Reuses
  // computeMaxPainFromChain; null when not feasible — never fabricated.
  const maxPain = computeMaxPainFromChain(contracts);

  // Regime levels: call wall (largest +gamma), put wall (largest −gamma), posture + read.
  const { callWall, putWall, regime } = computeGexRegime(
    strikeTotals,
    spot,
    zeroGammaFlip,
    maxPain
  );

  const heatmap: GexHeatmap = {
    underlying: root,
    spot,
    change_pct: changePct,
    asof: new Date().toISOString(),
    expiries,
    strikes: finalStrikes,
    cells,
    strike_totals: strikeTotals,
    zero_gamma_flip: zeroGammaFlip,
    call_wall: callWall,
    put_wall: putWall,
    max_pain: maxPain,
    regime,
    total_gex: prunedTotal || totalGex,
    source: "polygon",
    data_delay: POLYGON_OPTIONS_DATA_DELAY,
  };

  // Cache once for everyone: in-memory + Redis. 500 users → one matrix, zero per-user fetch.
  const entry = { at: now, data: heatmap };
  cachedHeatmaps.set(cacheKey, entry);
  void import("../shared-cache").then(({ sharedCacheSet }) =>
    sharedCacheSet(cacheKey, entry, Math.ceil(ttlMs / 1000))
  );

  return heatmap;
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
    const res = await polygonTrackedFetch(endpointKey, full, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      // Surface silent provider failures (invalid/non-Massive key, plan without
      // options-chain access, bad symbol). Host + status only — never the apiKey.
      console.warn(`[polygon-gex] chain fetch ${res.status} ${res.statusText || ""} from ${hostOf(full)} ${endpointKey}`.trim());
      return null;
    }
    return (await res.json()) as ChainResponse;
  } catch (err) {
    console.warn(`[polygon-gex] chain fetch threw from ${hostOf(full)} ${endpointKey}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function fetchChainBand(
  underlying: string,
  spot: number,
  expiry: string,
  bandPct = 0.015
): Promise<ChainContract[]> {
  const band = Math.max(spot * bandPct, bandPct >= 0.04 ? spot * 0.02 : 80);
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
  expiry = todayEtYmd(),
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
): Promise<Record<string, unknown>[]> {
  const { rows } = await fetchPolygonOdteDeskBundle(spot, expiry, { forceRefresh });
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
    // SPX + SPXW options both live under the I:SPX index underlying on Polygon/Massive.
    return fetchChainBand("I:SPX", spot, expiry, 0.015);
  }
  return fetchChainBand(root, spot, expiry, 0.015);
}

/** ATM ± bandPct chain snapshot for Night Hawk playbook validation. */
export async function fetchPolygonAtmOptionsChain(
  underlying: string,
  spot: number,
  expiry: string,
  bandPct = 0.05
): Promise<ChainContract[]> {
  if (!polygonConfigured() || spot <= 0) return [];
  const root = underlying.toUpperCase();
  if (root === "SPX") {
    // SPX + SPXW options both live under the I:SPX index underlying on Polygon/Massive.
    return fetchChainBand("I:SPX", spot, expiry, bandPct);
  }
  return fetchChainBand(root, spot, expiry, bandPct);
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

type RefContract = {
  expiration_date?: string;
  contract_type?: string;
  open_interest?: number;
};

type RefContractsResponse = {
  results?: RefContract[];
  next_url?: string;
};

const positioningCache = new Map<string, { at: number; bundle: PolygonPositioningBundle }>();

function positioningCacheMs(): number {
  const sec = Number(process.env.POLYGON_POSITIONING_CACHE_SEC ?? 30);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 30_000;
}

export type PolygonPositioningBundle = {
  rows: Record<string, unknown>[];
  maxPain: number | null;
  spot: number;
  source: "polygon";
  expiry: string;
};

/** GEX rows + max pain from Polygon options chain — any underlying (SPX uses SPX+SPXW). */
export async function fetchPolygonPositioningBundle(
  underlying: string,
  opts?: { spot?: number; expiry?: string }
): Promise<PolygonPositioningBundle> {
  const sym = underlying.toUpperCase();
  const expiry = opts?.expiry ?? todayEtYmd();
  const cacheKey = `${sym}:${expiry}`;
  const now = Date.now();
  const cached = positioningCache.get(cacheKey);
  if (cached && now - cached.at < positioningCacheMs()) {
    return cached.bundle;
  }

  if (!polygonConfigured()) {
    return { rows: [], maxPain: null, spot: 0, source: "polygon", expiry };
  }

  let spot = opts?.spot ?? 0;
  if (spot <= 0) {
    const snap = await fetchStockSnapshot(sym).catch(() => null);
    spot = snap?.price ?? 0;
  }
  if (spot <= 0) {
    return { rows: [], maxPain: null, spot: 0, source: "polygon", expiry };
  }

  const contracts = await fetchPolygonOptionsChain(sym, spot, expiry);
  const rows = aggregateGexRows(contracts, spot);
  const maxPain = computeMaxPainFromChain(contracts);
  const bundle: PolygonPositioningBundle = { rows, maxPain, spot, source: "polygon", expiry };
  if (rows.length) positioningCache.set(cacheKey, { at: now, bundle });
  return bundle;
}

/** OI aggregated by expiry from Polygon reference contracts (unlimited plan). */
export async function fetchPolygonOiByExpiry(
  underlying: string,
  limit = 12
): Promise<Array<{ expiry: string; call_oi: number; put_oi: number; total_oi: number }>> {
  if (!polygonConfigured()) return [];
  const root = underlying.toUpperCase();
  const today = todayEtYmd();
  const params = new URLSearchParams({
    underlying_ticker: root,
    expired: "false",
    limit: "250",
    sort: "expiration_date",
    order: "asc",
    "expiration_date.gte": today,
    apiKey: KEY,
  });

  const byExpiry = new Map<string, { call_oi: number; put_oi: number }>();
  let page: RefContractsResponse | null = await polygonRefFetch(`/v3/reference/options/contracts?${params}`);
  let guard = 0;

  while (page && guard < 12) {
    for (const c of page.results ?? []) {
      const expiry = String(c.expiration_date ?? "").slice(0, 10);
      if (!expiry) continue;
      const oi = Number(c.open_interest ?? 0);
      if (!oi) continue;
      const type = String(c.contract_type ?? "").toLowerCase();
      const row = byExpiry.get(expiry) ?? { call_oi: 0, put_oi: 0 };
      if (type === "call") row.call_oi += oi;
      else if (type === "put") row.put_oi += oi;
      byExpiry.set(expiry, row);
    }
    if (!page.next_url) break;
    page = await polygonRefFetch(page.next_url);
    guard += 1;
  }

  return Array.from(byExpiry.entries())
    .map(([expiry, oi]) => ({
      expiry,
      call_oi: oi.call_oi,
      put_oi: oi.put_oi,
      total_oi: oi.call_oi + oi.put_oi,
    }))
    .sort((a, b) => a.expiry.localeCompare(b.expiry))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// IV Term Structure
// ---------------------------------------------------------------------------

export type PolygonIvTermPoint = {
  expiry: string;
  avg_iv: number;
  call_iv: number;
  put_iv: number;
  dte: number;
};

type SnapshotContract = {
  details?: {
    expiration_date?: string;
    contract_type?: string;
  };
  implied_volatility?: number;
};

type SnapshotResponse = {
  results?: SnapshotContract[];
  next_url?: string;
};

const ivTermCache = new Map<string, { at: number; data: PolygonIvTermPoint[] }>();
const IV_TERM_CACHE_MS = 5 * 60_000; // 5 minutes

/**
 * Fetch IV term structure for a ticker from Polygon options chain snapshot.
 * Groups all contracts by expiry date and averages call + put IV per expiry.
 * Results are sorted ascending by expiry date and cached for 5 minutes.
 */
export async function fetchPolygonIvTermStructure(
  ticker: string
): Promise<PolygonIvTermPoint[]> {
  if (!polygonConfigured()) return [];
  const root = ticker.toUpperCase();
  const now = Date.now();
  const cached = ivTermCache.get(root);
  if (cached && now - cached.at < IV_TERM_CACHE_MS) return cached.data;

  const today = todayEtYmd();
  const todayMs = new Date(today).getTime();

  const params = new URLSearchParams({
    limit: "250",
    apiKey: KEY,
  });

  const byExpiry = new Map<
    string,
    { callIvSum: number; callCount: number; putIvSum: number; putCount: number }
  >();

  let page: SnapshotResponse | null = await polygonFetchUrl(
    `/v3/snapshot/options/${root}?${params}`
  ) as SnapshotResponse | null;
  let guard = 0;

  while (page && guard < 20) {
    for (const c of page.results ?? []) {
      const expiry = String(c.details?.expiration_date ?? "").slice(0, 10);
      if (!expiry || expiry < today) continue;
      const iv = Number(c.implied_volatility ?? 0);
      if (!iv || !Number.isFinite(iv)) continue;
      const type = String(c.details?.contract_type ?? "").toLowerCase();
      const row = byExpiry.get(expiry) ?? {
        callIvSum: 0,
        callCount: 0,
        putIvSum: 0,
        putCount: 0,
      };
      if (type === "call") {
        row.callIvSum += iv;
        row.callCount += 1;
      } else if (type === "put") {
        row.putIvSum += iv;
        row.putCount += 1;
      }
      byExpiry.set(expiry, row);
    }
    if (!page.next_url) break;
    page = await polygonFetchUrl(page.next_url) as SnapshotResponse | null;
    guard += 1;
  }

  const data: PolygonIvTermPoint[] = Array.from(byExpiry.entries())
    .map(([expiry, row]) => {
      const callIv = row.callCount > 0 ? row.callIvSum / row.callCount : 0;
      const putIv = row.putCount > 0 ? row.putIvSum / row.putCount : 0;
      const count = (row.callCount > 0 ? 1 : 0) + (row.putCount > 0 ? 1 : 0);
      const avg_iv = count > 0 ? (callIv + putIv) / count : 0;
      const expiryMs = new Date(expiry).getTime();
      const dte = Math.max(0, Math.round((expiryMs - todayMs) / 86_400_000));
      return {
        expiry,
        avg_iv: Number(avg_iv.toFixed(4)),
        call_iv: Number(callIv.toFixed(4)),
        put_iv: Number(putIv.toFixed(4)),
        dte,
      };
    })
    .filter((p) => p.avg_iv > 0)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));

  if (data.length) ivTermCache.set(root, { at: now, data });
  return data;
}

// ---------------------------------------------------------------------------
// Realized Volatility
// ---------------------------------------------------------------------------

export type PolygonRealizedVol = {
  realized_vol_30d: number;
  realized_vol_10d: number;
};

const realizedVolCache = new Map<string, { at: number; data: PolygonRealizedVol }>();
const REALIZED_VOL_CACHE_MS = 5 * 60_000; // 5 minutes

function annualizedVol(closes: number[], window: number): number {
  const slice = closes.slice(-window);
  if (slice.length < 2) return 0;
  const logReturns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0 && slice[i] > 0) {
      logReturns.push(Math.log(slice[i] / slice[i - 1]));
    }
  }
  if (logReturns.length < 2) return 0;
  const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
  const variance =
    logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (logReturns.length - 1);
  return Number((Math.sqrt(variance) * Math.sqrt(252)).toFixed(6));
}

/**
 * Compute annualized realized volatility for a ticker using Polygon daily bars.
 * Returns 30-day and 10-day realized vol. Cached for 5 minutes.
 */
export async function fetchPolygonRealizedVol(
  ticker: string,
  days = 30
): Promise<PolygonRealizedVol> {
  if (!polygonConfigured()) return { realized_vol_30d: 0, realized_vol_10d: 0 };
  const root = ticker.toUpperCase();
  const now = Date.now();
  const cached = realizedVolCache.get(root);
  if (cached && now - cached.at < REALIZED_VOL_CACHE_MS) return cached.data;

  // Import fetchAggBars from polygon-largo to avoid duplicating the bar-fetch logic.
  const { fetchAggBars } = await import("./polygon-largo");
  const today = todayEtYmd();
  // Fetch enough bars: max(days, 30) + buffer for weekends/holidays.
  const lookback = Math.max(days, 30);
  const fromDays = Math.ceil(lookback * 1.5) + 10;
  const fromDate = new Date(Date.now() - fromDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // For SPX use the Polygon index ticker prefix.
  const polyTicker = root === "SPX" ? "I:SPX" : root;
  const bars = await fetchAggBars(polyTicker, 1, "day", fromDate, today, String(lookback + 20)).catch(
    () => []
  );

  const closes = bars.map((b) => b.c).filter((c) => c > 0);
  const data: PolygonRealizedVol = {
    realized_vol_30d: annualizedVol(closes, 31), // 31 closes = 30 log-returns
    realized_vol_10d: annualizedVol(closes, 11), // 11 closes = 10 log-returns
  };

  if (data.realized_vol_30d > 0 || data.realized_vol_10d > 0) {
    realizedVolCache.set(root, { at: now, data });
  }
  return data;
}

// ---------------------------------------------------------------------------

async function polygonRefFetch(url: string): Promise<RefContractsResponse | null> {
  if (!polygonConfigured()) return null;
  const sep = url.includes("?") ? "&" : "?";
  const full = url.startsWith("http")
    ? `${url}${sep}apiKey=${KEY}`
    : `${BASE}${url}${sep}apiKey=${KEY}`;
  const endpointKey = url.startsWith("http")
    ? "/v3/reference/options/contracts"
    : url.split("?")[0] || "/v3/reference/options/contracts";
  try {
    const res = await polygonTrackedFetch(endpointKey, full, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as RefContractsResponse;
  } catch {
    return null;
  }
}
