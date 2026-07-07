import { polygonTrackedFetch } from "./polygon-rate-limiter";
import { computeVixTermStructure, type VixTermSnapshot } from "@/lib/vix-term-utils";
export { computeVixTermStructure, type VixTermSnapshot } from "@/lib/vix-term-utils";
import { polygonConfigured } from "./config";
import { sessionStatsFromMinuteBars, todayEtYmd, priorEtYmd } from "./spx-session";
import { smaFromCloses, emaFromCloses } from "./ma-math";
import { serverCache, TTL } from "@/lib/server-cache";

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = process.env.POLYGON_API_KEY ?? "";

/** Shared REST base/key for option-chain helpers outside this module (SPX play/lotto tickets). */
export function polygonRestBase(): string {
  return BASE;
}
export function polygonRestApiKey(): string {
  return KEY;
}

// The reactive circuit breaker (5 consecutive 429s → 60s pause, cluster pub/sub) now lives
// in polygon-rate-limiter.ts and is applied inside polygonTrackedFetch, which ALSO smooths
// every Polygon REST call through the permissive token bucket. polygonTrackedFetch throws
// on an open circuit (preserving the old throw-immediately gate) and notes 429/OK against
// the one shared breaker, so behavior here is unchanged: throws on circuit-open, throws on
// 429, returns json on ok.
async function polygonGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!polygonConfigured()) throw new Error("POLYGON_API_KEY not set");

  const qs = new URLSearchParams({ ...params, apiKey: KEY });
  const res = await polygonTrackedFetch(path, `${BASE}${path}?${qs}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (res.status === 429) throw new Error(`Polygon ${path} → 429 (rate limited)`);
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
  /** Day extremes / VWAP from the day aggregate. NULL when the aggregate is absent (pre-open /
   *  market closed / untraded) — do NOT dress the spot price up as a real HOD/LOD/VWAP
   *  (mirrors the gap #14 HOD/LOD null fix). */
  day_high: number | null;
  day_low: number | null;
  vwap: number | null;
  volume: number;
};

function _rowToSnapshot(sym: string, row: SnapshotTicker): StockQuoteSnapshot | null {
  const day = row.day ?? {};
  const prev = row.prevDay ?? {};
  const last = row.lastTrade ?? {};
  const price = Number(last.p ?? day.c ?? 0);
  // No usable price (no lastTrade AND no day close) is EXPECTED when the market is closed /
  // pre-open / the ticker simply hasn't traded — not an error. Return null quietly and let
  // callers degrade, instead of throwing (which used to surface as a misleading overnight
  // "Invalid price: 0" warning for SPY etc.). Only a genuinely implausible price is logged.
  if (!Number.isFinite(price) || price <= 0) return null;
  if (price > 1_000_000) {
    throw new Error(`[polygon] Implausible price for ${sym}: ${price}`);
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
    // Gap #14 (truth): when the day aggregate is absent (pre-open / closed / untraded) we have
    // no real HOD/LOD/VWAP — return null instead of dressing the spot price up as an extreme.
    day_high: day.h != null ? Number(day.h) : null,
    day_low: day.l != null ? Number(day.l) : null,
    vwap: day.vw != null ? Number(day.vw) : null,
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
    const ymd = todayEtYmd(d);
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

  // Filter out warrants (W suffix), reverse-split artifacts (<$1), and
  // micro-cap shells with negligible volume (<100K shares) that pollute the list.
  const isClean = (m: ReturnType<typeof mapMover>) =>
    m.price >= 1.0 &&
    !m.ticker.endsWith("W") &&
    !m.ticker.endsWith("R") &&
    (m.volume == null || m.volume >= 100_000);

  const combined = [
    ...(gainers.tickers ?? []).slice(0, limit).map(mapMover).filter(isClean),
    ...(losers.tickers ?? []).slice(0, limit).map(mapMover).filter(isClean),
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

    const price = Number(
      row.value ?? row.session?.close ?? row.session?.previous_close ?? 0
    );
    if (!Number.isFinite(price) || price <= 0) {
      // No usable value/session price — leave out[ticker] as null,
      // matching the stock snapshot contract (never emit price 0).
      continue;
    }

    out[ticker] = {
      symbol: ticker,
      price,
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
  // Benzinga channel names are SPACE-delimited + lowercase (verified live vs api.massive.com).
  // "analyst-ratings" (hyphen) returns ZERO results — the working name is "analyst ratings".
  // Broadened to the full analyst surface (ratings + price targets + up/downgrades + color)
  // for richer coverage; all confirmed to return data via the channels.any_of comma-list.
  return fetchBenzingaNews(limit, {
    ticker,
    channels: "analyst ratings,price target,upgrades,downgrades,analyst color",
  });
}

// ---------------------------------------------------------------------------
// Benzinga CATALYSTS (free on plan — confirmed-working channels, space-delimited lowercase).
//   These channels are entitled on the current plan and return data via
//   /benzinga/v2/news?channels.any_of=… but were previously unused. Benzinga news has no
//   rate limit, but we still CACHE per-ticker so 500 concurrent edition builds / users share
//   ONE upstream pull per ticker per window (the cache-reader rule). Catalysts move within a
//   session (an FDA decision / guidance cut breaks intraday), so they get a NEWS-grade TTL
//   (2 min) rather than the slow REFERENCE TTL the financials bundle uses.
// ---------------------------------------------------------------------------

/** A single recent corporate/event catalyst parsed from a confirmed-working Benzinga channel. */
export type BenzingaCatalyst = {
  /** The Benzinga channel(s) the article carried (e.g. "fda", "guidance", "m&a"). */
  channel: string;
  /** A coarse catalyst TYPE derived from the channel — drives the conservative scorer nudge. */
  type: "binary" | "guidance" | "m&a" | "insider" | "buyback" | "offering" | "short" | "ipo" | "other";
  title: string;
  published: string;
};

/** Confirmed-working, free, per-ticker catalyst channels (space-delimited lowercase, comma-listed). */
const BENZINGA_CATALYST_CHANNELS =
  "m&a,guidance,short sellers,insider trades,fda,buybacks,offerings,ipos";

/** Map a raw Benzinga channel name to a coarse catalyst type for downstream scoring/display. */
function catalystTypeFromChannels(channels: string[]): BenzingaCatalyst["type"] {
  const set = channels.map((c) => c.toLowerCase());
  const has = (needle: string) => set.some((c) => c.includes(needle));
  if (has("fda")) return "binary";
  if (has("guidance")) return "guidance";
  if (has("m&a") || has("m&amp;a") || has("merger") || has("acquisition")) return "m&a";
  if (has("insider")) return "insider";
  if (has("buyback")) return "buyback";
  if (has("offering")) return "offering";
  if (has("short")) return "short";
  if (has("ipo")) return "ipo";
  return "other";
}

/**
 * Classify catalyst type from article title text — used as fallback when the Massive/Benzinga
 * API returns articles with empty channels[] (the tickers.any_of filter strips channel metadata).
 */
function catalystTypeFromTitle(title: string): BenzingaCatalyst["type"] {
  const t = title.toLowerCase();
  if (t.includes("fda") || t.includes("approval") || t.includes("pdufa") || t.includes("clearance")) return "binary";
  if (t.includes("guidance") || t.includes("outlook") || t.includes("forecast") || t.includes("raises") || t.includes("lowers") || t.includes("cuts")) return "guidance";
  if (t.includes("merger") || t.includes("acqui") || t.includes("takeover") || t.includes("buyout") || t.includes(" deal")) return "m&a";
  if (t.includes("insider") || t.includes("ceo buy") || t.includes("cfo buy") || t.includes("director buy") || t.includes("10-k") || t.includes("form 4")) return "insider";
  if (t.includes("buyback") || t.includes("repurchase") || t.includes("share repurch")) return "buyback";
  if (t.includes("offering") || t.includes("secondary") || t.includes("dilut") || t.includes("public offering")) return "offering";
  if (t.includes("short") && (t.includes("seller") || t.includes("report") || t.includes("position"))) return "short";
  if (t.includes("ipo") || t.includes("initial public")) return "ipo";
  return "other";
}

/**
 * Recent corporate catalysts for a ticker.
 * Fetches all Benzinga news for the ticker (no channel filter — combining ticker+channel on the
 * Massive API returns 0), then classifies each article by title text. Filters out "other" type
 * articles to surface only actionable catalyst events.
 */
export async function fetchBenzingaCatalysts(
  ticker: string,
  limit = 8
): Promise<BenzingaCatalyst[]> {
  const sym = ticker.toUpperCase();
  return serverCache(`benzinga:catalysts:v2:${sym}`, TTL.NEWS, async () => {
    try {
      const articles = await fetchBenzingaNews(Math.min(limit * 4, 50), { ticker: sym });
      return articles
        .map((a) => {
          const channelType = catalystTypeFromChannels(a.channels);
          const type = channelType !== "other" ? channelType : catalystTypeFromTitle(a.title);
          return {
            channel: a.channels[0] ?? catalystTypeLabel(type),
            type,
            title: a.title,
            published: a.published,
          };
        })
        .filter((c) => c.title && c.type !== "other")
        .sort((a, b) => (b.published > a.published ? 1 : b.published < a.published ? -1 : 0))
        .slice(0, limit);
    } catch {
      return [];
    }
  });
}

function catalystTypeLabel(type: BenzingaCatalyst["type"]): string {
  const map: Record<string, string> = { binary: "FDA", guidance: "Guidance", "m&a": "M&A", insider: "Insider", buyback: "Buyback", offering: "Offering", short: "Short Sellers", ipo: "IPO" };
  return map[type] ?? "";
}

/**
 * Market-wide after-hours / movers context for the evening edition — the night's after-hours
 * center + movers headlines. ONE call across the whole market (no ticker filter). Cached on a
 * shared key (NEWS TTL) so every concurrent edition build / user shares one pull per window.
 */
export async function fetchBenzingaAfterHoursMovers(
  limit = 15
): Promise<BenzingaCatalyst[]> {
  return serverCache(`benzinga:afterhours-movers:${limit}`, TTL.NEWS, async () => {
    try {
      const articles = await fetchBenzingaNews(limit, {
        channels: "after-hours center,movers",
      });
      return articles
        .map((a) => ({
          channel: a.channels[0] ?? "",
          type: catalystTypeFromChannels(a.channels),
          title: a.title,
          published: a.published,
        }))
        .filter((c) => c.title)
        .sort((a, b) => (b.published > a.published ? 1 : b.published < a.published ? -1 : 0))
        .slice(0, limit);
    } catch {
      return [];
    }
  });
}

// ---------------------------------------------------------------------------
// Benzinga analyst price target (corrected channel).
//   The plan is NEWS-only — the structured /benzinga/v1/ratings + consensus-ratings
//   endpoints 403 (NOT ENTITLED) and the `analyst-ratings` channel returns []. The ONLY
//   working source is the `price target` channel on /benzinga/v2/news, where PTs appear
//   in article titles/teasers ("BofA raised MU price target to $1,500"). So we PARSE the
//   PT + firm + action out of the prose with a target-anchored regex.
// ---------------------------------------------------------------------------

export type BenzingaPriceTarget = {
  /** The parsed dollar target (the NEW target when an article cites both old→new). */
  price_target: number;
  firm: string | null;
  action: "raised" | "lowered" | "initiated" | "reiterated" | "maintained" | "set" | null;
  /** A one-line analyst summary suitable for the dossier. */
  summary: string;
  published: string;
  url: string;
};

const PT_FIRM_RE =
  /\b(BofA|Bank of America|Morgan Stanley|Goldman Sachs|Goldman|JPMorgan|JP Morgan|J\.P\. Morgan|Citigroup|Citi|Wells Fargo|Barclays|Deutsche Bank|UBS|Jefferies|Wedbush|Piper Sandler|Mizuho|Raymond James|Oppenheimer|Cowen|Evercore|Stifel|Truist|KeyBanc|Baird|Needham|Canaccord|Bernstein|RBC|BMO|Scotiabank|TD Cowen|HSBC|Susquehanna|Rosenblatt|Loop Capital|DA Davidson|Guggenheim|Wolfe Research|Argus|Benchmark|Roth|Craig-Hallum|Northland|William Blair|Macquarie)\b/i;

const PT_ACTION_RE =
  /\b(raise[sd]?|lift[sed]*|hike[sd]?|boost[sed]*|increase[sd]?|lower[sed]?|cut[s]?|reduce[sd]?|slash[esd]*|trim[sed]*|initiate[sd]?|start[s]?|reiterate[sd]?|maintain[sed]*|reaffirm[sed]*|keep[s]?|set[s]?)\b/i;

function normalizePtAction(raw: string | null): BenzingaPriceTarget["action"] {
  if (!raw) return null;
  const w = raw.toLowerCase();
  if (/rais|lift|hike|boost|increas/.test(w)) return "raised";
  if (/lower|cut|reduc|slash|trim/.test(w)) return "lowered";
  if (/initiat|start/.test(w)) return "initiated";
  if (/reiterat|reaffirm/.test(w)) return "reiterated";
  if (/maintain|keep/.test(w)) return "maintained";
  if (/set/.test(w)) return "set";
  return null;
}

/**
 * Parse a price target out of a single article's text. A `$` figure ONLY counts when it sits near a
 * "price target" / "PT" / "target" cue (within ~40 chars), so a random dollar figure in the body is
 * not mistaken for a PT. When the text cites old→new ("from $X to $Y" / "to $Y"), the NEW (last) value
 * near the cue wins. Returns null when no anchored target is found.
 */
export function parsePriceTargetFromText(text: string): { value: number; action: BenzingaPriceTarget["action"]; firm: string | null } | null {
  if (!text) return null;
  // Anchor: a "price target" / "PT" / "target" cue, then capture every $-figure within the trailing window.
  const cueRe = /(?:price\s*target|price\s*tgt|\bPT\b|\btarget\b)([^.;\n]{0,60})/gi;
  const dollarToken = /\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/;
  const firstDollar = (s: string): number | null => {
    const mm = s.match(dollarToken);
    if (!mm) return null;
    const v = Number(mm[1]!.replace(/,/g, ""));
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  let best: { value: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = cueRe.exec(text)) !== null) {
    const window = m[1] ?? "";
    let chosen: number | null = null;
    // "raised ... to $1,500 from $1,200" / "from $1,200 to $1,500": the NEW target is the value
    // following "to". Prefer that explicitly so an old→new revision never picks the old figure.
    const toM = window.match(/\bto\s+\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/i);
    if (toM) {
      const v = Number(toM[1]!.replace(/,/g, ""));
      if (Number.isFinite(v) && v > 0) chosen = v;
    }
    // Otherwise the first $-figure right after the cue ("price target of $X", "price target: $123").
    if (chosen == null) chosen = firstDollar(window);
    // Finally, a $-figure IMMEDIATELY BEFORE the cue ("$1,500 price target").
    if (chosen == null) {
      const pre = text.slice(Math.max(0, m.index - 24), m.index);
      const preM = pre.match(/\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*$/);
      if (preM) {
        const v = Number(preM[1]!.replace(/,/g, ""));
        if (Number.isFinite(v) && v > 0) chosen = v;
      }
    }
    if (chosen != null) {
      // Prefer the FIRST anchored target in the article (usually the headline claim).
      if (!best) best = { value: chosen };
    }
  }
  if (!best) return null;
  const actionM = text.match(PT_ACTION_RE);
  const firmM = text.match(PT_FIRM_RE);
  return {
    value: best.value,
    action: normalizePtAction(actionM?.[0] ?? null),
    firm: firmM?.[0] ?? null,
  };
}

/**
 * Fetch the most recent analyst price target for a ticker via the Benzinga `price target` news channel.
 * Returns null when no PT can be parsed from any recent article. (Channel fix: `price target`, NOT the
 * empty `analyst-ratings` channel.)
 */
export async function fetchBenzingaPriceTarget(
  ticker: string,
  limit = 10
): Promise<BenzingaPriceTarget | null> {
  const sym = ticker.toUpperCase();
  try {
    const articles = await fetchBenzingaNews(limit, { ticker: sym, channels: "price target" });
    for (const a of articles) {
      const text = `${a.title} ${a.teaser} ${a.body}`;
      const parsed = parsePriceTargetFromText(text);
      if (parsed) {
        return {
          price_target: parsed.value,
          firm: parsed.firm,
          action: parsed.action,
          summary: (a.title || a.teaser || "").slice(0, 200),
          published: a.published,
          url: a.url,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
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

/** Stock minute aggs (e.g. SPY volume proxy for SPX chart). */
export async function fetchStockMinuteBars(symbol: string, from: string, to: string) {
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

/**
 * REAL-TIME valuation / profitability / leverage / liquidity ratios.
 * GET /stocks/financials/v1/ratios?tickers=<SYM>&limit=1 (confirmed: filter is `tickers=`, NOT `ticker=`).
 * The endpoint returns one current snapshot per ticker; pe_ratio/roe/debt_to_equity are kept as the
 * original field names for backward-compat with passesFundamentalSanity + every existing consumer.
 */
export type PolygonFinancialRatios = {
  // — back-compat trio (do not rename: scorer.passesFundamentalSanity reads these) —
  pe_ratio: number | null;
  roe: number | null;
  debt_to_equity: number | null;
  // — widened valuation —
  price_to_book: number | null;
  price_to_sales: number | null;
  price_to_cash_flow: number | null;
  price_to_free_cash_flow: number | null;
  ev_to_ebitda: number | null;
  ev_to_sales: number | null;
  // — profitability / returns —
  return_on_assets: number | null;
  // — liquidity —
  current_ratio: number | null;
  quick_ratio: number | null;
  // — scale / cash / income —
  market_cap: number | null;
  enterprise_value: number | null;
  free_cash_flow: number | null;
  earnings_per_share: number | null;
  dividend_yield: number | null;
  price: number | null;
  as_of: string | null;
};

function ratioNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Real-time valuation / leverage / liquidity ratios — GET /stocks/financials/v1/ratios */
export async function fetchPolygonFinancialRatios(ticker: string): Promise<PolygonFinancialRatios | null> {
  const sym = ticker.toUpperCase();
  try {
    const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
      "/stocks/financials/v1/ratios",
      // The ratios endpoint filters on `tickers=` (plural) and returns the current snapshot.
      // We also keep the legacy `ticker`/sort params as harmless extras for resilience if the
      // upstream ever changes which alias it honors.
      { tickers: sym, ticker: sym, limit: "1", sort: "period_end.desc" }
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
      price_to_book: ratioNum(row.price_to_book ?? row.priceToBook),
      price_to_sales: ratioNum(row.price_to_sales ?? row.priceToSales),
      price_to_cash_flow: ratioNum(row.price_to_cash_flow ?? row.priceToCashFlow),
      price_to_free_cash_flow: ratioNum(row.price_to_free_cash_flow ?? row.priceToFreeCashFlow),
      ev_to_ebitda: ratioNum(row.ev_to_ebitda ?? row.evToEbitda),
      ev_to_sales: ratioNum(row.ev_to_sales ?? row.evToSales),
      return_on_assets: ratioNum(row.return_on_assets ?? row.roa ?? row.returnOnAssets),
      current_ratio: ratioNum(row.current ?? row.current_ratio ?? row.currentRatio),
      quick_ratio: ratioNum(row.quick ?? row.quick_ratio ?? row.quickRatio),
      market_cap: ratioNum(row.market_cap ?? row.marketCap),
      enterprise_value: ratioNum(row.enterprise_value ?? row.enterpriseValue),
      free_cash_flow: ratioNum(row.free_cash_flow ?? row.freeCashFlow),
      earnings_per_share: ratioNum(row.earnings_per_share ?? row.eps ?? row.earningsPerShare),
      dividend_yield: ratioNum(row.dividend_yield ?? row.dividendYield),
      price: ratioNum(row.price),
      // The ratios snapshot anchors to a period_end (or date) — surface whichever it returns.
      as_of:
        row.period_end != null
          ? String(row.period_end).slice(0, 10)
          : row.date != null
            ? String(row.date).slice(0, 10)
            : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Company financial statements (Massive `/stocks/financials/v1/*`).
//   CRITICAL: the filter param is `tickers=` (plural). Default sort is OLDEST-first,
//   so every call MUST pass `sort=period_end.desc` to get the latest periods first.
//   Pull enough periods (limit 5–8) to compute YoY growth + trends.
// ---------------------------------------------------------------------------

export type PolygonIncomeStatement = {
  period_end: string | null;
  fiscal_year: number | null;
  fiscal_quarter: string | null;
  timeframe: string | null; // "quarterly" | "annual"
  revenue: number | null;
  cost_of_revenue: number | null;
  gross_profit: number | null;
  operating_income: number | null;
  net_income: number | null;
  basic_eps: number | null;
  diluted_eps: number | null;
  research_development: number | null;
  ebitda: number | null;
  basic_shares: number | null;
  diluted_shares: number | null;
};

export type PolygonBalanceSheet = {
  period_end: string | null;
  fiscal_year: number | null;
  timeframe: string | null;
  cash_and_equivalents: number | null;
  debt_current: number | null;
  long_term_debt: number | null;
  total_assets: number | null;
  total_liabilities: number | null;
  total_equity: number | null;
  inventories: number | null;
  goodwill: number | null;
};

export type PolygonCashFlowStatement = {
  period_end: string | null;
  fiscal_year: number | null;
  timeframe: string | null;
  operating_cash_flow: number | null;
  capex: number | null;
  dividends: number | null;
  net_income: number | null;
};

function stmtParams(ticker: string, limit: number, timeframe?: "quarterly" | "annual"): Record<string, string> {
  const p: Record<string, string> = {
    tickers: ticker.toUpperCase(),
    sort: "period_end.desc",
    limit: String(Math.max(1, Math.min(limit, 12))),
  };
  if (timeframe) p.timeframe = timeframe;
  return p;
}

/** GET /stocks/financials/v1/income-statements — newest-first. */
export async function fetchPolygonIncomeStatements(
  ticker: string,
  limit = 6,
  timeframe?: "quarterly" | "annual"
): Promise<PolygonIncomeStatement[]> {
  try {
    const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
      "/stocks/financials/v1/income-statements",
      stmtParams(ticker, limit, timeframe)
    );
    return (data.results ?? []).map((r) => ({
      period_end: r.period_end != null ? String(r.period_end).slice(0, 10) : null,
      fiscal_year: ratioNum(r.fiscal_year),
      fiscal_quarter: r.fiscal_quarter != null ? String(r.fiscal_quarter) : null,
      timeframe: r.timeframe != null ? String(r.timeframe) : null,
      revenue: ratioNum(r.revenue),
      cost_of_revenue: ratioNum(r.cost_of_revenue),
      gross_profit: ratioNum(r.gross_profit),
      operating_income: ratioNum(r.operating_income),
      net_income: ratioNum(r.consolidated_net_income_loss ?? r.net_income ?? r.net_income_loss),
      basic_eps: ratioNum(r.basic_earnings_per_share ?? r.basic_eps),
      diluted_eps: ratioNum(r.diluted_earnings_per_share ?? r.diluted_eps),
      research_development: ratioNum(r.research_development ?? r.research_and_development),
      ebitda: ratioNum(r.ebitda),
      basic_shares: ratioNum(r.basic_shares_outstanding ?? r.basic_average_shares),
      diluted_shares: ratioNum(r.diluted_shares_outstanding ?? r.diluted_average_shares),
    }));
  } catch {
    return [];
  }
}

/** GET /stocks/financials/v1/balance-sheets — newest-first. */
export async function fetchPolygonBalanceSheets(
  ticker: string,
  limit = 6,
  timeframe?: "quarterly" | "annual"
): Promise<PolygonBalanceSheet[]> {
  try {
    const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
      "/stocks/financials/v1/balance-sheets",
      stmtParams(ticker, limit, timeframe)
    );
    return (data.results ?? []).map((r) => ({
      period_end: r.period_end != null ? String(r.period_end).slice(0, 10) : null,
      fiscal_year: ratioNum(r.fiscal_year),
      timeframe: r.timeframe != null ? String(r.timeframe) : null,
      cash_and_equivalents: ratioNum(r.cash_and_equivalents ?? r.cash_and_cash_equivalents),
      debt_current: ratioNum(r.debt_current ?? r.current_debt ?? r.short_term_debt),
      long_term_debt: ratioNum(
        r.long_term_debt_and_capital_lease_obligations ?? r.long_term_debt
      ),
      total_assets: ratioNum(r.total_assets),
      total_liabilities: ratioNum(r.total_liabilities),
      total_equity: ratioNum(r.total_equity ?? r.total_stockholders_equity),
      inventories: ratioNum(r.inventories ?? r.inventory),
      goodwill: ratioNum(r.goodwill),
    }));
  } catch {
    return [];
  }
}

/** GET /stocks/financials/v1/cash-flow-statements — newest-first. */
export async function fetchPolygonCashFlowStatements(
  ticker: string,
  limit = 6,
  timeframe?: "quarterly" | "annual"
): Promise<PolygonCashFlowStatement[]> {
  try {
    const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
      "/stocks/financials/v1/cash-flow-statements",
      stmtParams(ticker, limit, timeframe)
    );
    return (data.results ?? []).map((r) => ({
      period_end: r.period_end != null ? String(r.period_end).slice(0, 10) : null,
      fiscal_year: ratioNum(r.fiscal_year),
      timeframe: r.timeframe != null ? String(r.timeframe) : null,
      operating_cash_flow: ratioNum(
        r.net_cash_from_operating_activities ?? r.operating_cash_flow ?? r.cash_from_operations
      ),
      capex: ratioNum(
        r.purchase_of_property_plant_and_equipment ?? r.capital_expenditure ?? r.capex
      ),
      dividends: ratioNum(r.dividends ?? r.payment_of_dividends ?? r.dividends_paid),
      net_income: ratioNum(r.net_income ?? r.net_income_loss),
    }));
  } catch {
    return [];
  }
}

/**
 * Derived fundamental signals from the three statements. All trends are computed newest-vs-prior
 * over the supplied (newest-first) period arrays. Everything is null-tolerant: a missing input
 * yields a null signal rather than a fabricated 0.
 */
export type FundamentalSignals = {
  revenue_yoy_pct: number | null;       // latest revenue vs the same period a year ago
  revenue_qoq_pct: number | null;       // latest vs immediately prior period
  gross_margin_pct: number | null;
  operating_margin_pct: number | null;
  net_margin_pct: number | null;
  margin_trend: "expanding" | "contracting" | "flat" | null; // net margin direction
  fcf: number | null;                   // operating CF − |capex|, latest period
  fcf_positive: boolean | null;
  fcf_trend: "rising" | "falling" | "flat" | null;
  total_debt: number | null;            // debt_current + long_term_debt, latest
  cash: number | null;
  net_cash: number | null;              // cash − total_debt (>0 ⇒ net cash)
  net_cash_positive: boolean | null;
  eps_trajectory: "rising" | "falling" | "flat" | null;
  share_count_trend: "buyback" | "dilution" | "flat" | null;
  latest_period_end: string | null;
  timeframe: string | null;
};

function pctChange(latest: number | null, prior: number | null): number | null {
  if (latest == null || prior == null || !Number.isFinite(latest) || !Number.isFinite(prior)) return null;
  if (prior === 0) return null;
  return ((latest - prior) / Math.abs(prior)) * 100;
}

function marginPct(part: number | null, whole: number | null): number | null {
  if (part == null || whole == null || !Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) {
    return null;
  }
  return (part / whole) * 100;
}

function trendOf(latest: number | null, prior: number | null, flatPct = 2):
  | "rising"
  | "falling"
  | "flat"
  | null {
  const chg = pctChange(latest, prior);
  if (chg == null) return null;
  if (chg > flatPct) return "rising";
  if (chg < -flatPct) return "falling";
  return "flat";
}

export function computeFundamentalSignals(
  income: PolygonIncomeStatement[],
  balance: PolygonBalanceSheet[],
  cashFlow: PolygonCashFlowStatement[]
): FundamentalSignals | null {
  if (!income.length && !balance.length && !cashFlow.length) return null;

  const inc0 = income[0] ?? null;
  const incPrior = income[1] ?? null;
  // YoY: for quarterly series the same quarter a year ago is 4 periods back; for annual it's index 1.
  const isQuarterly = (inc0?.timeframe ?? "").toLowerCase().startsWith("q");
  const incYoY = isQuarterly ? income[4] ?? null : income[1] ?? null;

  const revenue_yoy_pct = pctChange(inc0?.revenue ?? null, incYoY?.revenue ?? null);
  const revenue_qoq_pct = pctChange(inc0?.revenue ?? null, incPrior?.revenue ?? null);

  const gross_margin_pct = marginPct(inc0?.gross_profit ?? null, inc0?.revenue ?? null);
  const operating_margin_pct = marginPct(inc0?.operating_income ?? null, inc0?.revenue ?? null);
  const net_margin_pct = marginPct(inc0?.net_income ?? null, inc0?.revenue ?? null);
  const priorNetMargin = marginPct(incPrior?.net_income ?? null, incPrior?.revenue ?? null);
  let margin_trend: FundamentalSignals["margin_trend"] = null;
  if (net_margin_pct != null && priorNetMargin != null) {
    const d = net_margin_pct - priorNetMargin;
    margin_trend = d > 0.5 ? "expanding" : d < -0.5 ? "contracting" : "flat";
  }

  const cf0 = cashFlow[0] ?? null;
  const cf1 = cashFlow[1] ?? null;
  const fcfOf = (cf: PolygonCashFlowStatement | null): number | null => {
    if (!cf || cf.operating_cash_flow == null) return null;
    const capexAbs = cf.capex != null ? Math.abs(cf.capex) : 0;
    return cf.operating_cash_flow - capexAbs;
  };
  const fcf = fcfOf(cf0);
  // Prefer the ratios-snapshot FCF in the dossier; here FCF derives from statements so the scorer
  // can reason about its TREND even when the snapshot only gives a single point.
  const fcfPrior = fcfOf(cf1);
  const fcf_positive = fcf != null ? fcf > 0 : null;
  const fcf_trend: FundamentalSignals["fcf_trend"] =
    fcf != null && fcfPrior != null
      ? fcf > fcfPrior * 1.02
        ? "rising"
        : fcf < fcfPrior * 0.98
          ? "falling"
          : "flat"
      : null;

  const bs0 = balance[0] ?? null;
  const total_debt =
    bs0 && (bs0.debt_current != null || bs0.long_term_debt != null)
      ? (bs0.debt_current ?? 0) + (bs0.long_term_debt ?? 0)
      : null;
  const cash = bs0?.cash_and_equivalents ?? null;
  const net_cash =
    cash != null && total_debt != null ? cash - total_debt : null;
  const net_cash_positive = net_cash != null ? net_cash > 0 : null;

  const eps_trajectory = trendOf(
    inc0?.diluted_eps ?? inc0?.basic_eps ?? null,
    incPrior?.diluted_eps ?? incPrior?.basic_eps ?? null
  );

  // Share count: FEWER shares ⇒ buyback (bullish); more ⇒ dilution.
  const sharesLatest = inc0?.diluted_shares ?? inc0?.basic_shares ?? null;
  const sharesPrior = incPrior?.diluted_shares ?? incPrior?.basic_shares ?? null;
  let share_count_trend: FundamentalSignals["share_count_trend"] = null;
  const shareChg = pctChange(sharesLatest, sharesPrior);
  if (shareChg != null) {
    share_count_trend = shareChg < -0.5 ? "buyback" : shareChg > 0.5 ? "dilution" : "flat";
  }

  return {
    revenue_yoy_pct,
    revenue_qoq_pct,
    gross_margin_pct,
    operating_margin_pct,
    net_margin_pct,
    margin_trend,
    fcf,
    fcf_positive,
    fcf_trend,
    total_debt,
    cash,
    net_cash,
    net_cash_positive,
    eps_trajectory,
    share_count_trend,
    latest_period_end: inc0?.period_end ?? bs0?.period_end ?? cf0?.period_end ?? null,
    timeframe: inc0?.timeframe ?? bs0?.timeframe ?? cf0?.timeframe ?? null,
  };
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

// ---------------------------------------------------------------------------
// Index moving averages.
//   PRIMARY: Massive's documented indices indicator endpoints
//     GET /v1/indicators/{ema,sma}/{I:TICKER}  ("Included in all Indices plans")
//   — server-computed over full history, one call, most accurate.
//   FALLBACK: derive from index aggregate bars when the endpoint returns null — the
//   "Request failed" entries seen in the SLA monitor were TRANSIENT (the same
//   api.massive.com connectivity blip as RT-2, badge still "OK · SLA"), NOT an
//   unsupported endpoint. The fallback keeps the desk MAs populated through a Massive
//   hiccup instead of leaving a hole. (An earlier change wrongly made bars the PRIMARY
//   on the inference that indices weren't supported; the docs confirm they ARE — bars
//   are the resilience fallback only.)
// ---------------------------------------------------------------------------

/** Oldest→newest index closes over enough bars to compute a `window`-period MA (fallback). */
async function indexClosesAsc(
  sym: string,
  window: number,
  timespan: "minute" | "hour" | "day"
): Promise<number[]> {
  const to = todayEtYmd();
  // Daily: ~2.2× the window in calendar days (covers weekends/holidays) + buffer so the
  // EMA seed converges. Intraday: a few sessions of minute bars (plenty for window ≤ ~60).
  const from = timespan === "day" ? priorEtYmd(Math.ceil(window * 2.2) + 15) : priorEtYmd(6);
  // fetchIndexDailyBars defaults to limit='10', which can't seed a 50/200-period MA — pass an
  // explicit limit sized to the window so enough daily bars return for emaFromCloses/smaFromCloses
  // (which require closes.length >= window) to populate the longer MAs during a Massive blip.
  const dailyLimit = String(Math.ceil(window * 2.2) + 15);
  const bars =
    timespan === "day"
      ? await fetchIndexDailyBars(sym, from, to, dailyLimit).catch(() => [])
      : await fetchIndexMinuteBars(sym, from, to).catch(() => []);
  return bars
    .filter((b) => Number.isFinite(b.c))
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
    .map((b) => b.c);
}

export async function fetchIndexEma(
  symbol: string,
  window: number,
  timespan: "minute" | "hour" | "day" = "minute"
): Promise<number | null> {
  const sym = symbol.toUpperCase();
  // Primary: the documented Massive indices EMA endpoint.
  const v = await latestIndicator(`/v1/indicators/ema/${sym}`, {
    window: String(window),
    timespan,
    series_type: "close",
    order: "desc",
    limit: "1",
  });
  if (v != null) return v;
  // Fallback: derive from bars when the endpoint blips.
  return emaFromCloses(await indexClosesAsc(sym, window, timespan), window);
}

export async function fetchIndexSma(
  symbol: string,
  window: number,
  timespan: "minute" | "hour" | "day" = "day"
): Promise<number | null> {
  const sym = symbol.toUpperCase();
  // Primary: the documented Massive indices SMA endpoint.
  const v = await latestIndicator(`/v1/indicators/sma/${sym}`, {
    window: String(window),
    timespan,
    series_type: "close",
    order: "desc",
    limit: "1",
  });
  if (v != null) return v;
  // Fallback: derive from bars when the endpoint blips.
  return smaFromCloses(await indexClosesAsc(sym, window, timespan), window);
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
  const sym = symbol.toUpperCase();
  // Null-safe like the other indicator getters (latestIndicator) — polygonGet THROWS on a non-OK
  // response, so a transient blip here would reject into callers instead of degrading to null.
  try {
    const data = await polygonGet<{ results?: { values?: Array<{ value?: number }> } }>(
      `/v1/indicators/rsi/${sym}`,
      { window: String(window), timespan, series_type: "close", limit: "1" }
    );
    const v = data?.results?.values?.[0]?.value;
    return v != null && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const VIX = "I:VIX";
let cachedVixIvRank: { at: number; rank: number | null } | null = null;

/**
 * VIX true IV Rank vs ~1y of daily closes — Polygon Indices Advanced (replaces UW IV rank when available).
 * TRUE IV RANK (TastyTrade convention): (current - min) / (max - min) * 100 over the trailing window — NOT a percentile.
 * Matches the "IV Rank" label and the UW fallback (fetchUwIvRank) so both sources agree.
 */
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

  // True IV Rank (TastyTrade convention): position of current within the trailing [min, max] window, not a percentile.
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min;
  const rank = span <= 0 ? 50 : Math.round(Math.min(100, Math.max(0, ((current - min) / span) * 100)));
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

