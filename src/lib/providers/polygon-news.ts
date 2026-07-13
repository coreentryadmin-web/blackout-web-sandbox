/**
 * BENZINGA NEWS / CATALYSTS READER (task #60 leg — data arsenal).
 *
 * ⚠️ TRUTH CORRECTION (2026-07-13, re-verified live): **Benzinga IS available on the Polygon key.**
 * `GET {POLYGON_API_BASE}/benzinga/v2/news?...&apiKey=KEY` returns 200 for channels=fda|guidance|m&a
 * and for ticker=NVDA&channels=earnings. There is NO separate Benzinga key — ride the Polygon key +
 * POLYGON_API_BASE, exactly like the other polygon-* readers. The old CLAUDE.md note
 * ("BENZINGA_API_KEY is missing → news won't fetch") is **STALE**; do not rely on a separate key.
 *
 * Governed, cached, fail-open readers for corporate news + catalysts:
 *   - fetchTickerNews(ticker)          — recent Benzinga news for one ticker (ticker-filtered)
 *   - fetchMarketCatalysts({channels}) — market-wide catalyst headlines by channel (fda/guidance/m&a…)
 *
 * Mirrors polygon-macro.ts / ticker-fundamentals.ts governance: own BASE/KEY, the SAME governed
 * request path (polygonTrackedFetch → cluster rate-limiter + circuit breaker + api-usage tracking),
 * an AbortSignal request timeout, secrets from env only, read-only (no writes). NEVER throws — every
 * error/timeout/miss returns { items: [], unavailable: <reason> } so a consumer degrades gracefully.
 *
 * SCOPE: new provider file only. Does NOT touch src/lib/bie/composers.ts or ecosystem-context.ts —
 * Track A consumes this as a #59 synthesis evidence leg.
 *
 * HONESTY: items are exactly what Benzinga returned (normalized); an empty-but-successful response is
 * items: [] with NO `unavailable` (real "no recent news"), distinct from an error, which sets
 * `unavailable` to the reason. `newest` is the freshest item's publish time — a real freshness anchor.
 */
import { polygonTrackedFetch } from "./polygon-rate-limiter";
import { polygonConfigured } from "./config";
import { serverCache, TTL } from "@/lib/server-cache";

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = process.env.POLYGON_API_KEY ?? "";

/** Per-request timeout (ms). Benzinga news has no rate limit but the round trip should stay bounded. */
const NEWS_TIMEOUT_MS = 8_000;

/**
 * Confirmed-working catalyst channels (space-delimited lowercase, comma-listed) — the same set the
 * existing polygon.ts catalyst reader uses. Combined via `channels.any_of`.
 */
export const DEFAULT_CATALYST_CHANNELS = "m&a,guidance,short sellers,insider trades,fda,buybacks,offerings,ipos";

export type NewsItem = {
  /** Benzinga article id (stable) — for de-duplication across calls. */
  id: string;
  headline: string;
  /** Always "benzinga" — the upstream provider, so a consumer can attribute the evidence. */
  source: string;
  /** Publish timestamp as Benzinga returns it (ISO-ish). */
  publishedAt: string;
  /** Benzinga channels the article carried (e.g. ["fda"], ["guidance"]). */
  channels: string[];
  /** Tickers Benzinga tagged the article with (uppercased). */
  tickers: string[];
  url: string;
};

export type NewsResult = {
  items: NewsItem[];
  /** When this read was performed (ISO). */
  asOf: string;
  /** Freshest item's publishedAt, or null when there are no items — a real freshness anchor. */
  newest: string | null;
  /** Set ONLY on error/timeout/unconfigured (fail-open). Absent on a successful read, even an empty one. */
  unavailable?: string;
};

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/**
 * Pure: normalize a raw Benzinga `/benzinga/v2/news` results array into typed NewsItems. Defensive —
 * tolerates missing fields, non-array `results`, and mixed id/url field names. Drops entries with no
 * headline (an article with no title is noise, not a catalyst).
 */
export function normalizeNewsArticles(raw: unknown): NewsItem[] {
  const results = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { results?: unknown })?.results)
      ? ((raw as { results: unknown[] }).results)
      : [];
  const items: NewsItem[] = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const a = r as Record<string, unknown>;
    const headline = str(a.title).trim();
    if (!headline) continue;
    items.push({
      id: str(a.id ?? a.benzinga_id),
      headline,
      source: "benzinga",
      publishedAt: str(a.published ?? a.created_at ?? a.updated ?? a.last_updated),
      channels: Array.isArray(a.channels) ? a.channels.map(str) : [],
      tickers: Array.isArray(a.tickers) ? a.tickers.map((t) => str(t).toUpperCase()) : [],
      url: str(a.url ?? a.benzinga_url ?? a.article_url),
    });
  }
  return items;
}

/** Pure: assemble a NewsResult (computes asOf + the freshest publishedAt anchor). */
export function buildNewsResult(items: NewsItem[], unavailable?: string): NewsResult {
  let newest: string | null = null;
  for (const it of items) {
    if (it.publishedAt && (newest == null || it.publishedAt > newest)) newest = it.publishedAt;
  }
  const result: NewsResult = { items, asOf: new Date().toISOString(), newest };
  if (unavailable) result.unavailable = unavailable;
  return result;
}

/** Governed GET — same rate-limiter/breaker/tracking path as polygon.ts's private polygonGet, plus a timeout. */
async function newsGet(path: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, apiKey: KEY });
  const res = await polygonTrackedFetch(path, `${BASE}${path}?${qs}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
  });
  if (res.status === 429) throw new Error(`Polygon ${path} → 429 (rate limited)`);
  if (!res.ok) throw new Error(`Polygon ${path} → ${res.status}`);
  return res.json();
}

async function fetchNews(
  cacheKey: string,
  params: Record<string, string>,
  label: string
): Promise<NewsResult> {
  if (!polygonConfigured()) return buildNewsResult([], "POLYGON_API_KEY not set");
  try {
    return await serverCache<NewsResult>(cacheKey, TTL.NEWS, async () => {
      const raw = await newsGet("/benzinga/v2/news", params);
      // A clean empty response is a real "no recent news" — NOT an error, so no `unavailable`.
      return buildNewsResult(normalizeNewsArticles(raw));
    });
  } catch (err) {
    // Fail-open: never throw. Not cached (serverCache stores only the resolved value), so a transient
    // outage self-heals on the next call rather than pinning an empty result for the TTL.
    return buildNewsResult([], `${label} unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Recent Benzinga news for ONE ticker. Ticker-filtered via `tickers.any_of`. `channels` is optional
 * (the article objects already carry `channels[]`, so a consumer can filter client-side); when passed
 * it is applied via `channels.any_of`. Cached per ticker+channel on the 2-minute NEWS tier so
 * concurrent consumers share one upstream pull per window.
 */
export async function fetchTickerNews(
  ticker: string,
  opts?: { limit?: number; channels?: string; since?: string }
): Promise<NewsResult> {
  const sym = ticker.trim().toUpperCase();
  const params: Record<string, string> = {
    limit: String(Math.min(opts?.limit ?? 12, 50)),
    sort: "published.desc",
    "tickers.any_of": sym,
  };
  if (opts?.channels) params["channels.any_of"] = opts.channels;
  if (opts?.since) params["published.gte"] = opts.since;
  const key = `benzinga:news:ticker:v1:${sym}:${opts?.channels ?? "all"}:${opts?.limit ?? 12}`;
  return fetchNews(key, params, `ticker news ${sym}`);
}

/**
 * Market-wide Benzinga CATALYST headlines by channel (no ticker filter). Defaults to the confirmed
 * catalyst channel set. Cached per channel-set on the 2-minute NEWS tier.
 */
export async function fetchMarketCatalysts(
  opts?: { channels?: string; limit?: number }
): Promise<NewsResult> {
  const channels = opts?.channels ?? DEFAULT_CATALYST_CHANNELS;
  const params: Record<string, string> = {
    limit: String(Math.min(opts?.limit ?? 20, 50)),
    sort: "published.desc",
    "channels.any_of": channels,
  };
  const key = `benzinga:news:catalysts:v1:${channels}:${opts?.limit ?? 20}`;
  return fetchNews(key, params, "market catalysts");
}
