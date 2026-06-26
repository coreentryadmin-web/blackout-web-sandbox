import { trackedFetch } from "@/lib/api-tracked-fetch";
import { isUwUpstream5xx } from "@/lib/uw-upstream-5xx";
import { isUwTransientNetwork } from "@/lib/uw-transient-network";
import {
  buildUwRequestKey,
  isUwCircuitOpen,
  noteUw429,
  runUwSequential,
  throttleUwCoalesced,
} from "@/lib/providers/uw-rate-limiter";
import {
  getUwCacheRedis,
  uwCacheGet,
  UW_CACHE_TTL,
  UW_KEYS,
} from "@/lib/providers/uw-shared-cache";
import { uwConfigured } from "./config";

// REDIS CACHE ACTIVE: with Redis caching most responses are served from cache, so
// live UW calls are rare. Pacing is owned by uw-rate-limiter.ts (UW_MAX_RPS default 2);
// override via the UW_MAX_RPS env var if a tighter/looser ceiling is ever needed.

const BASE = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
const KEY = process.env.UW_API_KEY ?? "";
const CLIENT_ID = process.env.UW_CLIENT_API_ID ?? "100001";

/** UW Advanced — live options chain, flow, GEX, lit/dark pool, vol analytics, WebSocket streaming. */
export const UW_PLAN_TIER = "advanced" as const;

function uwEnvSec(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Two-layer caching is INTENTIONAL — do not 'dedupe' this away.
//  * In-memory uwResponseCache (this file, L1): per-process, the ONLY cache for the
//    paths in uwCacheTtlMs that callers hit via raw uwGetSafe (economy, net-flow/expiry,
//    group-flow, economic-calendar). It also provides Redis-DOWN fresh-serve + the
//    circuit-open stale-serve fallback (up to UW_SLOW_CACHE_MAX_STALE_MS).
//  * Redis uwCacheGet (uw-shared-cache.ts, L2): cross-process/shared cache, used only by
//    the high-level fetchers (e.g. fetchUwMarketTide).
// /api/market/market-tide is the single path that passes through BOTH (Redis L2 in
// fetchUwMarketTide, then in-memory L1 inside uwGetSafe). That overlap is kept on purpose:
// removing market-tide from uwCacheTtlMs would drop its in-process hit + circuit-open
// stale fallback whenever Redis is unavailable, lowering the covered-path hit-rate and
// changing the resilience of an SPX-desk signal. So the L1 entry stays.
type UwCacheSlot = { data: unknown; fetchedAt: number; ttlMs: number };
const uwResponseCache = new Map<string, UwCacheSlot>();
const UW_SLOW_CACHE_MAX_STALE_MS = 60 * 60 * 1000;

function uwCacheTtlMs(path: string): number {
  if (path.startsWith("/api/economy/")) return uwEnvSec("UW_ECONOMY_CACHE_SEC", 3600) * 1000;
  if (path === "/api/market/market-tide") return uwEnvSec("UW_MARKET_TIDE_CACHE_SEC", 300) * 1000;
  if (path === "/api/net-flow/expiry") return uwEnvSec("UW_NET_FLOW_CACHE_SEC", 120) * 1000;
  if (path.includes("/api/group-flow/")) return uwEnvSec("UW_GROUP_FLOW_CACHE_SEC", 180) * 1000;
  if (path === "/api/market/economic-calendar") return uwEnvSec("UW_MACRO_CALENDAR_CACHE_SEC", 3600) * 1000;
  return 0;
}

function uwEffectiveTtlMs(baseMs: number): number {
  if (isUwCircuitOpen()) return Math.max(baseMs, 30 * 60 * 1000);
  return baseMs;
}

function readUwCache<T>(key: string, allowStale: boolean): T | undefined {
  const slot = uwResponseCache.get(key);
  if (!slot) return undefined;
  const age = Date.now() - slot.fetchedAt;
  const ttl = uwEffectiveTtlMs(slot.ttlMs);
  if (age <= ttl) return slot.data as T;
  if (allowStale && age <= UW_SLOW_CACHE_MAX_STALE_MS) return slot.data as T;
  return undefined;
}

function writeUwCache(key: string, path: string, data: unknown): void {
  const ttlMs = uwCacheTtlMs(path);
  if (ttlMs <= 0) return;
  uwResponseCache.set(key, { data, fetchedAt: Date.now(), ttlMs });
}

async function uwGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  if (!uwConfigured()) throw new Error("UW_API_KEY not set");
  if (isUwCircuitOpen()) throw new Error(`Unusual Whales ${path} → 429 circuit`);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));

  const url = `${BASE}${path}${qs.size ? `?${qs}` : ""}`;
  const requestKey = buildUwRequestKey(path, params);

  // Coalesce on the PARSED JSON, not the Response. A Response body is a one-shot stream,
  // so handing the same in-flight Response to concurrent callers made the 2nd .json()
  // throw 'body already read' — silently dropping greek-exposure / net-prem desk data
  // under load (uwGetSafe swallowed it as null). Parsing inside the coalesced fn lets
  // every concurrent caller share one already-parsed payload.
  return throttleUwCoalesced(requestKey, async () => {
    const res = await trackedFetch("unusual_whales", path, url, {
      headers: {
        Authorization: `Bearer ${KEY}`,
        Accept: "application/json",
        "UW-CLIENT-API-ID": CLIENT_ID,
      },
      cache: "no-store",
    });
    if (res.status === 429) {
      // Do NOT count the 429 here. uwGetSafe's catch is the single counting site
      // (noteUw429) for the breaker; counting in both this fetch path AND the catch
      // double-incremented recent429Timestamps, tripping the breaker at half
      // CIRCUIT_429_THRESHOLD (and faster under request coalescing: 1 here + N waiters
      // in the catch). Direct-uwGet callers (fetchMarketFlowAlertRows) record the 429
      // in their own catch instead.
      throw new Error(`Unusual Whales ${path} → 429`);
    }
    if (!res.ok) throw new Error(`Unusual Whales ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  });
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
  /** UW flow-alerts rule — RepeatedHits, RepeatedHitsAscendingFill, etc. */
  alert_rule: string | null;
  trade_count: number | null;
  has_sweep: boolean;
};

/** Parse an OCC option symbol (e.g. "GOOG260116C00200000") → strike + expiry + side.
 *  UW's WebSocket flow_alerts payload often carries the contract as an OCC symbol
 *  rather than split strike/expiry fields — which left HELIX rows showing "0C -"
 *  once the WS became the primary writer. */
function parseOccSymbol(sym: string): { strike: number; expiry: string; option_type: string } | null {
  const m = /([A-Z.]{1,6})(\d{6})([CP])(\d{8})/.exec(sym.toUpperCase());
  if (!m) return null;
  const [, , ymd, cp, strikeRaw] = m;
  const expiry = `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`;
  const strike = Number(strikeRaw) / 1000;
  return {
    strike: Number.isFinite(strike) ? strike : 0,
    expiry,
    option_type: cp === "P" ? "PUT" : "CALL",
  };
}

export function parseUwFlowAlert(row: Record<string, unknown>): MarketFlowAlert {
  // strike/expiry/side: cover REST + WS key variants, then fall back to parsing the
  // OCC option symbol (the WS flow_alerts feed sends the contract symbol, not split
  // fields — REST already had strike/expiry, so this only adds, never overrides).
  let strike = Number(row.strike ?? row.strike_price ?? 0);
  let expiry = String(row.expiry ?? row.expiry_date ?? row.expiration ?? "").slice(0, 10);
  let optRaw = String(row.type ?? row.option_type ?? "").toLowerCase();
  if (!strike || !expiry || !optRaw) {
    const occRaw = String(
      row.option_chain ?? row.option_symbol ?? row.osi_symbol ?? row.chain ?? row.contract ?? ""
    );
    const occ = occRaw ? parseOccSymbol(occRaw) : null;
    if (occ) {
      if (!strike) strike = occ.strike;
      if (!expiry) expiry = occ.expiry;
      if (!optRaw) optRaw = occ.option_type.toLowerCase();
    }
  }
  // TRUTH MANDATE (audit gap #6): never DEFAULT a missing side to "call" — that
  // rendered a real PUT as BULLISH and inverted the whole bull/bear read. When the
  // side is genuinely unparseable, mark it UNKNOWN/non-directional so it is excluded
  // from CALL/PUT tallies and live bias rather than fabricated as a bullish call.
  const isPut = optRaw.startsWith("p");
  const isCall = optRaw.startsWith("c");
  const optionType = isPut ? "PUT" : isCall ? "CALL" : "UNKNOWN";
  const direction = isPut ? "bearish" : isCall ? "bullish" : "unknown";

  const premium = Number(row.total_premium ?? row.premium ?? 0);
  // Leave dte null (route unknown) when expiry is absent — do NOT default dte to 99,
  // which previously forced route="stock" on every timestamp/expiry-less print.
  const dte = expiry ? Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000) : null;
  const route =
    premium >= 1_000_000 ? "whale" : dte == null ? "" : dte <= 0 ? "0dte" : "stock";

  // Do NOT fall back to NOW: a timestampless print defaulted to now() looked fresh and
  // produced false Velocity Radar / LIVE-badge spikes. Surface it as "" (unknown) — the
  // persist layer derives the REAL event time from raw.created_at/start_time, and the
  // live tape excludes empty alerted_at from LIVE + sort (audit gap #6).
  let alertedAt = String(row.created_at ?? "");
  if (!alertedAt && row.start_time) {
    const ts = Number(row.start_time);
    if (Number.isFinite(ts)) alertedAt = new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
  }

  const ruleRaw = String(row.alert_rule ?? row.rule_name ?? "").trim();
  const tradeRaw = Number(row.trade_count ?? 0);

  return {
    ticker: String(row.ticker ?? "").toUpperCase(),
    premium,
    option_type: optionType,
    expiry,
    strike,
    direction,
    score: Number(row.score ?? 0),
    route,
    // "" when UW gave no real timestamp — never a fabricated now(). An unknown-side
    // row still carries its real time when UW sent one (side and time are independent).
    alerted_at: alertedAt,
    alert_rule: ruleRaw || null,
    trade_count: Number.isFinite(tradeRaw) && tradeRaw > 0 ? tradeRaw : null,
    has_sweep: Boolean(row.has_sweep),
  };
}

/** @deprecated use parseUwFlowAlert */
const rowToFlow = parseUwFlowAlert;

async function uwGetSafe<T>(
  path: string,
  params: Record<string, string | number> = {},
  retries = 2
): Promise<T | null> {
  if (!uwConfigured()) return null;

  const cacheKey = buildUwRequestKey(path, params);
  const cacheable = uwCacheTtlMs(path) > 0;
  const freshCached = cacheable ? readUwCache<T>(cacheKey, false) : undefined;
  if (freshCached !== undefined) return freshCached;

  if (isUwCircuitOpen()) {
    const stale = cacheable ? readUwCache<T>(cacheKey, true) : undefined;
    if (stale !== undefined) return stale;
    return null;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await uwGet<T>(path, params);
      if (cacheable) writeUwCache(cacheKey, path, data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("403")) {
        console.error(`[uw] PLAN_BLOCKED ${path} — endpoint requires higher tier. Returning null.`);
        return null;
      }
      if (msg.includes("429")) {
        noteUw429(path);
        if (attempt < retries) {
          const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
          if (process.env.UW_DEBUG_RETRIES === "1") {
            console.debug(`[uw] RATE_LIMITED ${path} — retry ${attempt + 1} in ${delay.toFixed(0)}ms`);
          }
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        const stale = cacheable ? readUwCache<T>(cacheKey, true) : undefined;
        if (stale !== undefined) return stale;
        console.warn(`[uw] RATE_LIMITED ${path} — exhausted retries`);
        return null;
      }
      // Transient upstream 5xx (502/503/504 blips). NOT a rate-limit, so do NOT call
      // noteUw429 — it must never feed the 429 breaker. Retry with bounded backoff, then
      // fall to stale cache so a single blip can't blank the desk.
      if (isUwUpstream5xx(msg)) {
        if (attempt < retries) {
          const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
          if (process.env.UW_DEBUG_RETRIES === "1") {
            console.debug(`[uw] UPSTREAM_5XX ${path} — retry ${attempt + 1} in ${delay.toFixed(0)}ms`);
          }
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        const stale = cacheable ? readUwCache<T>(cacheKey, true) : undefined;
        if (stale !== undefined) return stale;
        console.warn(`[uw] UPSTREAM_5XX ${path} — exhausted retries`);
        return null;
      }
      // Transient connect/network blip (UND_ERR_CONNECT_TIMEOUT, EHOSTUNREACH, `fetch
      // failed`, ECONNRESET, a DNS hiccup — the RT-2 class in 00-RUNTIME-FINDINGS.md).
      // NOT an HTTP status error, so it must NOT feed the 429 breaker. Mirror the 5xx
      // branch: bounded-backoff retry, then fall to stale cache so a momentary
      // api.unusualwhales.com blip can't blank the desk (previously this fell straight
      // through to `return null` with no retry and no stale fallback).
      if (isUwTransientNetwork(msg)) {
        if (attempt < retries) {
          const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
          if (process.env.UW_DEBUG_RETRIES === "1") {
            console.debug(`[uw] NETWORK_BLIP ${path} — retry ${attempt + 1} in ${delay.toFixed(0)}ms`);
          }
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        const stale = cacheable ? readUwCache<T>(cacheKey, true) : undefined;
        if (stale !== undefined) return stale;
        console.warn(`[uw] NETWORK_BLIP ${path} — exhausted retries`);
        return null;
      }
      return null;
    }
  }
  return null;
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

/** Normalize any UW per-strike GEX row to the {strike, call_gamma_oi, put_gamma_oi}
 *  shape analyzeStrikeGexRows expects, tolerating UW's varied field names across the
 *  spot-exposures and greek-exposure endpoints. */
function normalizeUwStrikeGexRow(r: Record<string, unknown>): Record<string, unknown> | null {
  const strike = Number(r.strike ?? r.strike_price);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  let callG = Number(r.call_gamma_oi ?? r.call_gex ?? r.call_gamma ?? NaN);
  let putG = Number(r.put_gamma_oi ?? r.put_gex ?? r.put_gamma ?? NaN);
  if (!Number.isFinite(callG) && !Number.isFinite(putG)) {
    // Some greek-exposure rows give a single net gamma rather than a call/put split.
    const net = Number(r.gamma_oi ?? r.net_gamma_oi ?? r.gex ?? r.net_gex ?? NaN);
    if (!Number.isFinite(net)) return null;
    callG = net; // put the whole net on one side so (call+put) === net downstream
    putG = 0;
  } else {
    callG = Number.isFinite(callG) ? callG : 0;
    putG = Number.isFinite(putG) ? putG : 0;
  }
  return { strike, call_gamma_oi: callG, put_gamma_oi: putG };
}

/**
 * UW fallback for the GEX strike ladder when the Polygon/Massive chain is empty.
 * Tries the 0DTE-correct spot-exposures feed first, then greek-exposure/strike
 * (cumulative — available on plans where /greek-exposure works, which this one is).
 * NOTE: UW spot-exposures endpoints have been observed returning 503 in production
 * (see nighthawk/positioning.ts, spx-desk.ts) — Polygon is the primary GEX source and
 * this whole path is a last-resort fallback. The attempt is kept (cheap, self-logging)
 * so it auto-recovers if UW restores the feed.
 * Returns normalized rows + which source produced them. Logs each attempt so the live
 * source (and any 503/empty) is visible without exposing the UW key.
 */
export async function fetchUwOdteGexLadder(
  ticker = "SPX"
): Promise<{ rows: Record<string, unknown>[]; source: string }> {
  const attempts: Array<[string, () => Promise<Record<string, unknown>[]>]> = [
    ["spot-exposures/expiry-strike (0DTE)", () => fetchUwOdteSpotExposuresByStrike(ticker)],
    ["greek-exposure/strike (cumulative)", () => fetchUwGreekExposureStrike(ticker)],
  ];
  for (const [name, fn] of attempts) {
    try {
      const raw = await fn();
      const rows = raw
        .map((r) => normalizeUwStrikeGexRow(r))
        .filter((r): r is Record<string, unknown> => r !== null);
      if (rows.length) {
        // Success → info, NOT warn: for SPX (an index not carried in the Polygon/Massive options feed)
        // this UW spot-exposures ladder is the DE-FACTO GEX source, not a degradation — logging it as
        // warn made a healthy per-cycle build read as a red error in Railway (finding #76). The
        // source-failure paths below still warn (those are genuine fallback-chain degradations).
        console.info(`[uw-gex] ${ticker} ladder from ${name}: ${rows.length} strikes`);
        return { rows, source: name };
      }
      console.warn(`[uw-gex-fallback] ${ticker} ${name} returned 0 usable strikes`);
    } catch (err) {
      console.warn(`[uw-gex-fallback] ${ticker} ${name} threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { rows: [], source: "none" };
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
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.marketTide(), UW_CACHE_TTL.marketTide, async () => {
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
  });
}

export async function fetchUwNope(ticker = "SPX") {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.nope(ticker), UW_CACHE_TTL.nope, async () => {
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
  });
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

/**
 * Aggregate flow-per-strike rows → the 0DTE flow tilt `{ call_premium, put_premium, net }`.
 * SHARED by `fetchUwFlow0dte` (the live read) and the `uw-cache-refresh` cron (the warm) so both
 * produce the IDENTICAL aggregate and the warm can never write a shape the live read doesn't expect.
 * SHAPE/KEY CONTRACT: this AGGREGATE lives under `UW_KEYS.flowPerStrike` (`flow_per_strike:`); the
 * RAW rows live under the DISTINCT `flow_per_strike_rows:` key (`fetchUwFlowPerStrikeRows`). Never
 * cross-write the two — doing so poisons the SPX desk + Largo 0DTE-flow reads (array vs aggregate).
 */
export function aggregateFlowPerStrikeRows(rows: ReadonlyArray<Record<string, unknown>>): {
  call_premium: number;
  put_premium: number;
  net: number;
} {
  let calls = 0;
  let puts = 0;
  for (const row of rows) {
    calls += Number(row.call_premium ?? 0);
    puts += Number(row.put_premium ?? 0);
  }
  return { call_premium: calls, put_premium: puts, net: calls - puts };
}

export async function fetchUwFlow0dte(ticker = "SPX") {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.flowPerStrike(ticker), UW_CACHE_TTL.flowPerStrike, async () => {
    const data = await uwGetSafe<unknown>(`/api/stock/${ticker}/flow-per-strike-intraday`, {});
    return aggregateFlowPerStrikeRows(extractRows(data));
  });
}

type MarketFlowRow = { raw: Record<string, unknown>; flow: MarketFlowAlert };

const MARKET_FLOW_CACHE_KEY = "uw:market_flow_alerts";

let marketFlowCache: { expiresAt: number; cachedAt: number; rows: MarketFlowRow[] } | null = null;

const MARKET_FLOW_MAX_STALE_MS = 30 * 60 * 1000;

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
  const limit = Math.min(params?.limit ?? 50, 450);
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

function flowRowTimestamp(row: MarketFlowRow): number {
  const ms = Date.parse(row.flow.alerted_at);
  return Number.isFinite(ms) ? ms : 0;
}

function flowRowKey(row: MarketFlowRow): string {
  const id = row.raw.id ?? row.raw.uuid ?? row.raw.alert_id;
  if (id != null && String(id).trim()) return String(id);
  const f = row.flow;
  return `${f.ticker}|${f.alerted_at}|${f.strike}|${f.premium}`;
}

async function fetchMarketFlowAlertPage(
  query: Record<string, string | number>
): Promise<MarketFlowRow[]> {
  const data = await uwGet<unknown>("/api/option-trades/flow-alerts", query);
  return extractRows(data).map((raw) => ({ raw, flow: rowToFlow(raw) }));
}

export async function fetchMarketFlowAlertRows(params?: {
  limit?: number;
  ticker?: string;
  min_premium?: number;
  newer_than?: string;
  older_than?: string;
}): Promise<MarketFlowRow[]> {
  const now = Date.now();
  const hasFreshCache = marketFlowCache && marketFlowCache.expiresAt > now;
  const desired = Math.min(params?.limit ?? 50, 450);

  if (!params?.newer_than && !params?.older_than) {
    if (hasFreshCache) {
      return filterMarketFlowRows(marketFlowCache!.rows, params);
    }
    try {
      const { sharedCacheGet } = await import("../shared-cache");
      const redisRows = await sharedCacheGet<MarketFlowRow[]>(MARKET_FLOW_CACHE_KEY);
      if (redisRows?.length) {
        marketFlowCache = { expiresAt: now + marketFlowCacheMs(), cachedAt: now, rows: redisRows };
        return filterMarketFlowRows(redisRows, params);
      }
    } catch {
      /* fall through to fetch */
    }
  }

  const baseQuery: Record<string, string | number> = {
    limit: Math.min(desired, 200),
  };
  if (params?.ticker) baseQuery.ticker_symbol = params.ticker.toUpperCase();
  if (params?.min_premium) baseQuery.min_premium = params.min_premium;
  if (params?.newer_than) baseQuery.newer_than = params.newer_than;

  try {
    const paginate = !params?.ticker && desired > 200;
    const merged: MarketFlowRow[] = [];
    const seen = new Set<string>();
    let olderThan: string | undefined = params?.older_than;

    for (let page = 0; page < (paginate ? 3 : 1); page++) {
      const query: Record<string, string | number> = {
        ...baseQuery,
        limit: Math.min(200, desired - merged.length),
      };
      if (olderThan) query.older_than = olderThan;

      let batch: MarketFlowRow[];
      try {
        batch = await fetchMarketFlowAlertPage(query);
      } catch (pageErr) {
        // fetchMarketFlowAlertPage uses raw uwGet (no internal retry/stale fallback), so a
        // 429/5xx on page 2+ used to throw out of the loop and DISCARD pages already merged,
        // serving only the (older) marketFlowCache. Instead: keep the pages we have.
        //  - first page failed (nothing merged yet) → rethrow so the outer catch runs the
        //    existing stale-cache / breaker-accounting path UNCHANGED.
        //  - already have pages → note the 429 here (the outer catch won't run; preserve the
        //    once-per-failed-attempt breaker count) and break to return the partial merge.
        if (merged.length === 0) throw pageErr;
        const pmsg = pageErr instanceof Error ? pageErr.message : String(pageErr);
        if (pmsg.includes("429")) noteUw429("market/flow-alerts");
        console.warn(
          `[uw] flow-alerts page ${page} failed after ${merged.length} rows — serving partial:`,
          pmsg
        );
        break;
      }
      if (!batch.length) break;

      for (const row of batch) {
        const key = flowRowKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }

      if (!paginate || merged.length >= desired || batch.length < 200) break;

      const oldest = batch.reduce(
        (acc, row) => {
          const ts = flowRowTimestamp(row);
          return ts < acc.ts ? { ts, iso: row.flow.alerted_at } : acc;
        },
        { ts: Infinity, iso: "" }
      );
      if (!oldest.iso || oldest.ts === Infinity) break;
      olderThan = oldest.iso;
    }

    if (!params?.newer_than && !params?.older_than) {
      marketFlowCache = { expiresAt: now + marketFlowCacheMs(), cachedAt: now, rows: merged };
      void import("../shared-cache").then(({ sharedCacheSet }) =>
        sharedCacheSet(MARKET_FLOW_CACHE_KEY, merged, Math.ceil(marketFlowCacheMs() / 1000))
      );
    }
    return filterMarketFlowRows(merged, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("429")) {
      // fetchMarketFlowAlertRows uses uwGet directly (not uwGetSafe), and the 429 count
      // was removed from uwGet's fetch path — record it here so this endpoint still
      // contributes to the breaker once per failed attempt (path isn't in scope at this
      // catch, so use the static endpoint label).
      noteUw429("market/flow-alerts");
    }
    if (marketFlowCache && now - marketFlowCache.cachedAt <= MARKET_FLOW_MAX_STALE_MS) {
      console.warn("[uw] flow-alerts rate limited — serving cache:", message);
      return filterMarketFlowRows(marketFlowCache.rows, params);
    }
    if (marketFlowCache) {
      console.warn("[uw] flow-alerts cache too stale — not serving:", message);
    } else {
      console.warn("[uw] flow-alerts failed:", message);
    }
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
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.darkPoolTicker(ticker), UW_CACHE_TTL.darkPoolTicker, async () => {
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
      // Gap #6 (truth): a print with no real executed_at must be DROPPED, not stamped now()
      // — fabricating the current time sorted undated prints into the live tape as
      // just-executed. No trustworthy timestamp → not on the tape.
      if (!execAt) continue;
      if (!execAt.startsWith(today)) continue;

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
        executed_at: execAt.slice(0, 19),
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
  });
}

/**
 * Normalize a raw UW `off_lit_trades` WebSocket payload into DarkPoolSnapshot shape.
 * The WS sends individual trade objects (or arrays of them) — not the REST aggregate structure.
 */
export function normalizeDarkPoolWsPayload(raw: unknown): DarkPoolSnapshot | null {
  const rows = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.data;
  const list = Array.isArray(rows) ? rows : typeof raw === "object" && raw !== null ? [raw] : [];
  if (!list.length) return null;

  const today = todayIso();
  const prints: DarkPoolPrint[] = [];
  let callPrem = 0;
  let putPrem = 0;
  let total = 0;

  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const execAt = String(r.executed_at ?? r.date ?? r.timestamp ?? "");
    // Convert the trade timestamp to ET before extracting the date, so trades between
    // 8 PM–midnight ET (UTC next day) are not silently discarded as "wrong date".
    const execDate = execAt
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(execAt))
      : "";
    // Gap #6 (truth): no real executed_at → DROP the print, never stamp now(). A fabricated
    // timestamp sorted undated prints into the live tape as just-executed.
    if (!execAt) continue;
    if (execDate !== today) continue;
    const premium = Number(r.premium ?? r.size ?? r.notional ?? 0);
    if (premium <= 0) continue;
    const strikeRaw = Number(r.strike ?? r.price ?? r.ref_price ?? 0);
    const strike = Number.isFinite(strikeRaw) ? bucketPrice(strikeRaw) : 0;
    const side = String(r.side ?? r.direction ?? "unknown").toLowerCase();
    const optType = String(r.type ?? r.option_type ?? "").toLowerCase();
    prints.push({ strike, premium, side, executed_at: execAt.slice(0, 19) });
    total += premium;
    if (optType.includes("call")) callPrem += premium;
    else if (optType.includes("put")) putPrem += premium;
  }

  if (!prints.length) return null;
  const bias = darkPoolBias(callPrem, putPrem, total);
  return {
    prints: prints.slice(0, 20),
    total_premium: total,
    call_premium: callPrem,
    put_premium: putPrem,
    bias,
    pcr: callPrem > 0 ? Math.round((putPrem / callPrem) * 100) / 100 : null,
    detail: `${prints.length} print(s) · $${(total / 1_000_000).toFixed(2)}M`,
  };
}

/** Normalize UW `interval_flow` WS payload into strike-level intraday flow rows. */
export function normalizeIntervalFlowWsPayload(raw: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.data;
  const list = Array.isArray(rows) ? rows : typeof raw === "object" && raw !== null ? [raw] : [];
  const out: Record<string, unknown>[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const strike = Number(r.strike ?? 0);
    if (!Number.isFinite(strike)) continue;
    out.push({
      strike,
      call_premium: Number(r.call_premium ?? r.call_volume ?? 0),
      put_premium: Number(r.put_premium ?? r.put_volume ?? 0),
    });
  }
  return out;
}

export type TradingHaltEvent = {
  symbol: string;
  halt_type: string;
  reason: string | null;
  halted_at: string | null;
  active: boolean;
};

/** Normalize UW `trading_halts` WS payload into halt events. */
export function normalizeTradingHaltsWsPayload(raw: unknown): TradingHaltEvent[] {
  const rows = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.data;
  const list = Array.isArray(rows) ? rows : typeof raw === "object" && raw !== null ? [raw] : [];
  const out: TradingHaltEvent[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const symbol = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!symbol) continue;
    const haltType = String(r.halt_type ?? r.type ?? r.state ?? "halt").toLowerCase();
    const active =
      haltType.includes("halt") ||
      haltType.includes("paused") ||
      Boolean(r.halted ?? r.is_halted ?? r.active);
    out.push({
      symbol,
      halt_type: haltType,
      reason: r.reason != null ? String(r.reason) : null,
      halted_at: r.halted_at != null ? String(r.halted_at) : r.timestamp != null ? String(r.timestamp) : null,
      active,
    });
  }
  return out;
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
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.netPremTicks(ticker), UW_CACHE_TTL.netPremTicks, async () => {
    const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/net-prem-ticks`, {});
    const rows = extractRows(data);
    return rows
      .map((r) => ({
        time: String(r.timestamp ?? r.time ?? r.t ?? ""),
        net: Number(r.net_premium ?? r.net ?? r.value ?? 0),
      }))
      .filter((t) => t.time)
      .slice(-40);
  });
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

/**
 * Per-strike intraday flow ROWS. Cache-reader, like its ~25 sibling accessors: the upstream
 * /flow-per-strike-intraday call is wrapped in `uwCacheGet` so staggered callers (heatmap overlay
 * limit 250, Largo + cron limit 30) collapse to ONE upstream fetch per ticker per TTL — previously
 * it was only request-COALESCED, so each staggered caller spent from the scarce 2-RPS cluster UW
 * budget.
 *
 * KEY: a DISTINCT `flow_per_strike_rows:${ticker}` key (NOT the existing `UW_KEYS.flowPerStrike`,
 * which `fetchUwFlow0dte` already uses for an incompatible AGGREGATE shape — reusing it would
 * collide row-array vs {call_premium,put_premium,net}). TTL mirrors the sibling flow accessor
 * (`UW_CACHE_TTL.flowPerStrike`, 2 min). We cache the UNSLICED rows and slice per-caller AFTER
 * the read, so the 250-row heatmap caller and the 30-row Largo/cron callers share one cached fetch
 * without one starving the other's window.
 */
export async function fetchUwFlowPerStrikeRows(ticker = "SPX", limit = 30) {
  const sym = ticker.toUpperCase();
  const redis = await getUwCacheRedis();
  const rows = await uwCacheGet(redis, `flow_per_strike_rows:${sym}`, UW_CACHE_TTL.flowPerStrike, async () => {
    const data = await uwGetSafe<unknown>(`/api/stock/${sym}/flow-per-strike-intraday`, {});
    return extractRows(data);
  });
  return rows.slice(0, limit);
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

// UW's Sector Tide enum uses Yahoo/ETF-style GICS sector NAMES (e.g. "Financial Services",
// "Consumer Cyclical"), matched case-insensitively. Single-word sectors (technology/energy/
// healthcare) worked by luck; "financials" and "consumer_discretionary" are the classic GICS
// labels UW does NOT accept and were 400ing ("Invalid sector") on every uw-cache-refresh cron
// + any Largo get_sector_flow call. This normalizes common GICS/legacy aliases to the exact UW
// enum name so both call sites stop failing. Unknown values pass through (lowercased) unchanged.
const UW_SECTOR_ALIASES: Record<string, string> = {
  financials: "financial services",
  financial: "financial services",
  "financial-services": "financial services",
  consumer: "consumer cyclical",
  "consumer discretionary": "consumer cyclical",
  consumer_discretionary: "consumer cyclical",
  "consumer-discretionary": "consumer cyclical",
  "consumer staples": "consumer defensive",
  consumer_staples: "consumer defensive",
  "consumer-staples": "consumer defensive",
  materials: "basic materials",
  "basic-materials": "basic materials",
  communications: "communication services",
  communication: "communication services",
  telecom: "communication services",
  "communication-services": "communication services",
  "information technology": "technology",
  tech: "technology",
  "health care": "healthcare",
  reit: "real estate",
  reits: "real estate",
  "real-estate": "real estate",
};

export function normalizeUwSector(sector: string): string {
  const lower = sector.trim().toLowerCase().replace(/\s+/g, " ");
  return UW_SECTOR_ALIASES[lower] ?? lower;
}

export async function fetchUwSectorTide(sector = "technology") {
  const normalized = normalizeUwSector(sector);
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.sectorTide(normalized), UW_CACHE_TTL.sectorTide, async () => {
    const data = await uwGetSafe<Record<string, unknown>>(`/api/market/${encodeURIComponent(normalized)}/sector-tide`, {});
    if (!data) return null;
    const block = data.data;
    const row = Array.isArray(block) ? block[block.length - 1] : block;
    return row ?? null;
  });
}

export async function fetchUwInsiderFlow(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/insider-buy-sells`, {});
}

export async function fetchUwCongressTrades(ticker?: string, limit = 25) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.congress(), UW_CACHE_TTL.congress, async () => {
    const params: Record<string, string | number> = { limit: Math.min(limit, 100) };
    if (ticker) params.ticker = ticker.toUpperCase();
    return uwGetSafe<unknown>("/api/congress/recent-trades", params);
  });
}

/** @deprecated Use fetchShortInterest from polygon.ts as primary (Polygon short interest — no rate limit). UW short float is fallback only when Polygon returns null. */
export async function fetchUwShortFloat(ticker: string) {
  return uwGetSafe<unknown>(`/api/shorts/${ticker.toUpperCase()}/interest-float/v2`, {});
}

export async function fetchUwShortScreener(limit = 15) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.shortScreener(), UW_CACHE_TTL.shortScreener, async () => {
    const data = await uwGetSafe<unknown>("/api/shorts/screener", { limit: Math.min(limit, 50) });
    return extractRows(data).slice(0, limit);
  });
}

export async function fetchUwFlowPerExpiry(ticker: string, limit = 12) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.flowPerExpiry(ticker), UW_CACHE_TTL.flowPerExpiry, async () => {
    const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/flow-per-expiry`, {});
    return extractRows(data).slice(0, limit);
  });
}

/** @deprecated Use fetchPolygonTickerDetails from polygon-largo.ts instead (Polygon reference data — no rate limit). */
export async function fetchUwStockInfo(ticker: string) {
  return uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/info`, {});
}

/** @deprecated Use fetchBenzingaEarnings from polygon.ts as primary (unlimited, no rate limit). UW earnings is supplemental only. */
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
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.screenerStocks(), UW_CACHE_TTL.screenerStocks, async () => {
    const data = await uwGetSafe<unknown>("/api/screener/stocks", { limit: Math.min(limit, 50) });
    return extractRows(data).slice(0, limit);
  });
}

export async function fetchUwUnusualTrades(ticker?: string, limit = 20) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.unusualTrades(), UW_CACHE_TTL.unusualTrades, async () => {
    const params: Record<string, string | number> = { limit: Math.min(limit, 100) };
    const data = await uwGetSafe<unknown>("/api/unusual-trades/recent", params);
    let rows = extractRows(data);
    if (ticker) {
      const t = ticker.toUpperCase();
      rows = rows.filter((r) => String(r.ticker ?? "").toUpperCase() === t);
    }
    return rows.slice(0, limit);
  });
}

/** @deprecated Use fetchBenzingaNews from polygon.ts as primary (unlimited via Polygon/Massive plan). UW news quota reserved for flow/tide/dark pool. */
export async function fetchUwNewsHeadlines(ticker: string, limit = 12) {
  const data = await uwGetSafe<unknown>("/api/news/headlines", {
    ticker: ticker.toUpperCase(),
    limit: Math.min(limit, 50),
  });
  return extractRows(data).slice(0, limit);
}

/** @deprecated Use fetchBenzingaNews from polygon.ts as primary (no ticker filter variant). UW news quota reserved for flow/tide/dark pool. */
/** Market-wide headlines — no ticker filter. */
export async function fetchUwMarketNewsHeadlines(limit = 20) {
  const data = await uwGetSafe<unknown>("/api/news/headlines", {
    limit: Math.min(limit, 50),
  });
  return extractRows(data).slice(0, limit);
}

/** @deprecated Use fetchMarketMovers from polygon.ts instead (gainers/losers via Polygon batch snapshot — no rate limit). */
export async function fetchUwMarketMovers(limit = 15) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.marketMovers(), UW_CACHE_TTL.marketMovers, async () => {
    const data = await uwGetSafe<unknown>("/api/market/movers", { limit: Math.min(limit, 50) });
    return extractRows(data).slice(0, limit);
  });
}

export async function fetchUwMarketTopNetImpact(limit = 15) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.topNetImpact(), UW_CACHE_TTL.topNetImpact, async () => {
    const data = await uwGetSafe<unknown>("/api/market/top-net-impact", { limit: Math.min(limit, 50) });
    return extractRows(data).slice(0, limit);
  });
}

export async function fetchUwMarketOiChange(limit = 25) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.marketOiChange(), UW_CACHE_TTL.marketOiChange, async () => {
    const data = await uwGetSafe<unknown>("/api/market/oi-change", { limit: Math.min(limit, 100) });
    return extractRows(data).slice(0, limit);
  });
}

export async function fetchUwAtmChains(ticker: string, expirationDate?: string, limit = 30) {
  const params: Record<string, string | number> = {
    limit,
    expiration_date: expirationDate ?? todayIso(),
  };
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
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.etfTide(etf), UW_CACHE_TTL.etfTide, () =>
    uwGetSafe<unknown>(`/api/etf/${etf.toUpperCase()}/tide`, {})
  );
}

export async function fetchUwLitFlow(ticker: string, limit = 20) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.litFlow(ticker), UW_CACHE_TTL.litFlow, async () => {
    const data = await uwGetSafe<unknown>("/api/lit-flow/ticker", {
      ticker: ticker.toUpperCase(),
      limit: Math.min(limit, 50),
    });
    return extractRows(data).slice(0, limit);
  });
}

export async function fetchUwScreenerContracts(limit = 20) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.screenerContracts(), UW_CACHE_TTL.screenerContracts, async () => {
    const data = await uwGetSafe<unknown>("/api/screener/contracts", { limit: Math.min(limit, 100) });
    return extractRows(data).slice(0, limit);
  });
}

export async function fetchUwSeasonality(ticker: string) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.seasonality(ticker), UW_CACHE_TTL.seasonality, async () => {
    const data = await uwGetSafe<unknown>(`/api/seasonality/${ticker.toUpperCase()}/monthly`, {});
    return extractRows(data);
  });
}

export async function fetchUwCongressLateReports(limit = 20) {
  const data = await uwGetSafe<unknown>("/api/congress/late-reports", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

/** @deprecated Use fetchShortVolume from polygon.ts as primary (Polygon short volume data — no rate limit). UW short volume is fallback only when Polygon returns empty results. */
export async function fetchUwShortVolume(ticker: string, limit = 15) {
  const data = await uwGetSafe<unknown>(`/api/shorts/${ticker.toUpperCase()}/volume-and-ratio`, {});
  return extractRows(data).slice(0, limit);
}

export async function fetchUwFtds(ticker: string, limit = 15) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.ftds(ticker), UW_CACHE_TTL.ftds, async () => {
    const data = await uwGetSafe<unknown>(`/api/shorts/${ticker.toUpperCase()}/ftds`, {});
    return extractRows(data).slice(0, limit);
  });
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

export async function fetchUwInsiderTransactions(ticker: string, limit = 15) {
  const data = await uwGetSafe<unknown>("/api/insider/transactions", {
    ticker: ticker.toUpperCase(),
    limit: Math.min(limit, 50),
  });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwFdaCalendar(ticker: string, limit = 10) {
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.fdaCalendar(), UW_CACHE_TTL.fdaCalendar, async () => {
    const data = await uwGetSafe<unknown>("/api/market/fda-calendar", {
      ticker: ticker.toUpperCase(),
      limit: Math.min(limit, 20),
    });
    return extractRows(data).slice(0, limit);
  });
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
export async function fetchUwFlowRecent(ticker: string, limit = 25): Promise<MarketFlowAlert[]> {
  const data = await uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/flow-recent`, {
    limit: Math.min(limit, 100),
  });
  return extractRows(data)
    .map((raw) => parseUwFlowAlert(raw))
    .slice(0, limit);
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
  const redis = await getUwCacheRedis();
  return uwCacheGet(redis, UW_KEYS.darkPoolRecent(), UW_CACHE_TTL.darkPoolRecent, async () => {
    const data = await uwGetSafe<unknown>("/api/darkpool/recent", { limit: Math.min(limit, 100) });
    return extractRows(data).slice(0, limit);
  });
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

/**
 * @deprecated Use fetchPolygonMtfTechnicals from polygon-largo.ts instead (full MTF stack via Polygon — no rate limit).
 * UW technical indicators are fallback only when Polygon MTF returns null.
 */
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

export async function fetchUwPredictionsInsiders(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/predictions/insiders", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwPredictionsSmartMoney(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/predictions/smart-money", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwPredictionsUnusual(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/predictions/unusual", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export async function fetchUwPredictionsWhales(limit = 25) {
  const data = await uwGetSafe<unknown>("/api/predictions/whales", { limit: Math.min(limit, 100) });
  return extractRows(data).slice(0, limit);
}

export type PredictionConsensusSignal = {
  ticker: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence_pct: number;
  sources: string[];
  headline: string;
};

function parsePredictionRow(row: Record<string, unknown>, source: string): PredictionConsensusSignal | null {
  const ticker = String(row.ticker ?? row.symbol ?? row.asset ?? row.underlying ?? "").toUpperCase();
  if (!ticker || ticker.length > 6) return null;

  const bullish = Number(row.bullish_pct ?? row.bullish ?? row.yes_pct ?? row.long_pct ?? 0);
  const bearish = Number(row.bearish_pct ?? row.bearish ?? row.no_pct ?? row.short_pct ?? 0);
  let confidence = Number(row.confidence ?? row.confidence_score ?? row.score ?? row.conviction ?? 0);
  if (confidence <= 0) confidence = Math.max(bullish, bearish);

  let direction: "bullish" | "bearish" | "neutral" = "neutral";
  if (bullish > bearish + 5) direction = "bullish";
  else if (bearish > bullish + 5) direction = "bearish";

  const confidence_pct = confidence > 0 && confidence <= 1 ? confidence * 100 : confidence;
  if (!Number.isFinite(confidence_pct) || confidence_pct <= 0) return null;

  const pct = Number(confidence_pct.toFixed(0));
  return {
    ticker,
    direction,
    confidence_pct: pct,
    sources: [source],
    headline: `${source.replace(/_/g, " ")} ${pct}% ${direction} on ${ticker}`,
  };
}

function mergePredictionSignals(
  byTicker: Map<string, PredictionConsensusSignal>,
  rows: Record<string, unknown>[],
  source: string
) {
  for (const r of rows) {
    const sig = parsePredictionRow(r, source);
    if (!sig) continue;
    const cur = byTicker.get(sig.ticker);
    if (!cur) {
      byTicker.set(sig.ticker, sig);
      continue;
    }
    byTicker.set(sig.ticker, {
      ...cur,
      confidence_pct: Math.max(cur.confidence_pct, sig.confidence_pct),
      sources: Array.from(new Set([...cur.sources, ...sig.sources])),
      direction: sig.confidence_pct >= cur.confidence_pct ? sig.direction : cur.direction,
      headline:
        sig.confidence_pct >= cur.confidence_pct
          ? sig.headline
          : `${cur.sources.join("+")} ${cur.confidence_pct}% ${cur.direction} on ${cur.ticker}`,
    });
  }
}

/** UW prediction-market consensus — insiders, smart money, unusual, whales. */
export async function fetchUwPredictionsConsensus(limit = 20, ticker?: string) {
  const [insiders, smart, unusual, whales] = await Promise.all([
    fetchUwPredictionsInsiders(limit),
    fetchUwPredictionsSmartMoney(limit),
    fetchUwPredictionsUnusual(limit),
    fetchUwPredictionsWhales(limit),
  ]);

  const byTicker = new Map<string, PredictionConsensusSignal>();
  mergePredictionSignals(byTicker, insiders, "insiders");
  mergePredictionSignals(byTicker, smart, "smart_money");
  mergePredictionSignals(byTicker, unusual, "unusual");
  mergePredictionSignals(byTicker, whales, "whales");

  let signals = Array.from(byTicker.values()).sort((a, b) => b.confidence_pct - a.confidence_pct);
  if (ticker) {
    const filterSym = sym(ticker);
    signals = signals.filter((s) => s.ticker === filterSym);
  }

  return {
    source: "unusual_whales",
    signal_count: signals.length,
    top_signals: signals.slice(0, limit),
    raw_counts: {
      insiders: insiders.length,
      smart_money: smart.length,
      unusual: unusual.length,
      whales: whales.length,
    },
  };
}

export async function fetchUwGreekFlow(ticker: string, expiry?: string, limit = 500) {
  const s = sym(ticker);
  const path = expiry
    ? `/api/stock/${s}/greek-flow/${expiry}`
    : `/api/stock/${s}/greek-flow`;
  const data = await uwGetSafe<unknown>(path, { limit: Math.min(limit, 500) });
  return extractRows(data);
}

export type UwMacroIndicatorSnapshot = {
  indicator: string;
  label: string;
  latest_value: number | null;
  prior_value: number | null;
  change_pct: number | null;
  as_of: string | null;
  rows: Record<string, unknown>[];
};

export const UW_MACRO_INDICATORS = [
  { id: "GDP", slug: "gdp", label: "GDP" },
  { id: "CPI", slug: "cpi", label: "CPI" },
  { id: "UNRATE", slug: "unemployment", label: "Unemployment" },
] as const;

/** UW economy paths use kebab slugs — not FRED tickers (UNRATE) or uppercase (GDP). */
const UW_ECONOMY_SLUG_ALIASES: Record<string, string> = {
  GDP: "gdp",
  CPI: "cpi",
  UNRATE: "unemployment",
  UNEMPLOYMENT: "unemployment",
  INFLATION: "inflation",
  "FED-FUNDS": "fed-funds",
  FED_FUNDS: "fed-funds",
  "TREASURY-YIELD": "treasury-yield",
  TREASURY_YIELD: "treasury-yield",
  "GDP-PER-CAPITA": "gdp-per-capita",
  GDP_PER_CAPITA: "gdp-per-capita",
  "RETAIL-SALES": "retail-sales",
  RETAIL_SALES: "retail-sales",
  DURABLES: "durables",
  PAYROLLS: "payrolls",
};

const UW_ECONOMY_VALID_SLUGS = new Set([
  "gdp",
  "gdp-per-capita",
  "treasury-yield",
  "fed-funds",
  "cpi",
  "inflation",
  "retail-sales",
  "durables",
  "unemployment",
  "payrolls",
]);

function resolveUwEconomySlug(indicator: string): string {
  const trimmed = indicator.trim();
  const upper = trimmed.toUpperCase().replace(/_/g, "-");
  const fromAlias = UW_ECONOMY_SLUG_ALIASES[upper];
  if (fromAlias) return fromAlias;

  const lower = trimmed.toLowerCase();
  if (UW_ECONOMY_VALID_SLUGS.has(lower)) return lower;

  return lower;
}

function resolveMacroLabel(indicator: string, slug: string): string {
  const id = indicator.toUpperCase().trim();
  return UW_MACRO_INDICATORS.find((m) => m.id === id)?.label ?? slug;
}

function parseEconomyIndicatorRows(
  indicator: string,
  label: string,
  rows: Record<string, unknown>[]
): UwMacroIndicatorSnapshot {
  const sorted = [...rows].sort((a, b) => {
    const ta = String(a.date ?? a.as_of ?? a.period ?? "");
    const tb = String(b.date ?? b.as_of ?? b.period ?? "");
    return tb.localeCompare(ta);
  });
  const latest = sorted[0];
  const prior = sorted[1];
  const latestVal = latest ? Number(latest.value ?? latest.actual ?? latest.reading ?? NaN) : NaN;
  const priorVal = prior ? Number(prior.value ?? prior.actual ?? prior.reading ?? NaN) : NaN;
  const latest_value = Number.isFinite(latestVal) ? latestVal : null;
  const prior_value = Number.isFinite(priorVal) ? priorVal : null;
  const change_pct =
    latest_value != null && prior_value != null && prior_value !== 0
      ? Number((((latest_value - prior_value) / Math.abs(prior_value)) * 100).toFixed(2))
      : null;
  return {
    indicator,
    label,
    latest_value,
    prior_value,
    change_pct,
    as_of: latest ? String(latest.date ?? latest.as_of ?? latest.period ?? "") || null : null,
    rows: sorted.slice(0, 12),
  };
}

export async function fetchUwEconomyIndicator(indicator: string): Promise<UwMacroIndicatorSnapshot> {
  const id = indicator.toUpperCase().trim();
  const slug = resolveUwEconomySlug(indicator);
  const label = resolveMacroLabel(indicator, slug);
  const data = await uwGetSafe<unknown>(`/api/economy/${slug}`, {});
  const rows = extractRows(data) as Record<string, unknown>[];
  return parseEconomyIndicatorRows(id, label, rows);
}

export async function fetchUwMacroIndicators(
  indicators: string[] = UW_MACRO_INDICATORS.map((m) => m.id)
): Promise<UwMacroIndicatorSnapshot[]> {
  const results = await runUwSequential(
    indicators.map((id) => () => fetchUwEconomyIndicator(id).catch(() => null))
  );
  return results.filter((r): r is UwMacroIndicatorSnapshot => r != null);
}

export async function fetchUwGroupGreekFlow(group: string, expiry?: string, limit = 500) {
  const g = group.toLowerCase().trim();
  const path = expiry
    ? `/api/group-flow/${g}/greek-flow/${expiry}`
    : `/api/group-flow/${g}/greek-flow`;
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

export async function fetchUwSpotExposures(ticker = "SPX") {
  return uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/spot-exposures`, {});
}

export async function fetchUwOptionPriceLevels(ticker = "SPX") {
  return uwGetSafe<unknown>(`/api/stock/${ticker.toUpperCase()}/option/stock-price-levels`, {});
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

/** @deprecated Use fetchAggBars from polygon-largo.ts as primary (Polygon OHLCV aggregates — no rate limit). UW OHLC is fallback only when Polygon returns empty results. */
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

/** @deprecated Use fetchPolygonDividends from polygon-largo.ts as primary. UW dividends is fallback only when Polygon returns empty results. */
export async function fetchUwCompaniesDividends(ticker: string, limit = 20) {
  const data = await uwGetSafe<unknown>(`/api/companies/${sym(ticker)}/dividends`, { limit: Math.min(limit, 50) });
  return extractRows(data).slice(0, limit);
}

/** @deprecated Use fetchPolygonSplits from polygon-largo.ts as primary. UW splits is fallback only when Polygon returns empty results. */
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

/** @deprecated Use fetchBenzingaAnalystRatings from polygon.ts as primary. UW screener/analysts is fallback only when Benzinga returns no results for the ticker. */
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

export async function fetchUwGlobalFlowAlerts(
  limit = 30,
  params?: Record<string, string | number>
): Promise<MarketFlowAlert[]> {
  const data = await uwGetSafe<unknown>("/api/option-trades/flow-alerts", {
    limit: Math.min(limit, 200),
    ...params,
  });
  return extractRows(data)
    .map((raw) => parseUwFlowAlert(raw))
    .slice(0, limit);
}
