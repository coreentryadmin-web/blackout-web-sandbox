/**
 * POLYGON RELATED-COMPANIES READER (task #62 — Polygon data arsenal).
 *
 * Governed, cached, ticker-filtered reader for `/v1/related-companies/{ticker}` — Polygon's peer set
 * for a name (returns up to ~10 tickers Polygon associates with it). Live-confirmed under the Polygon
 * key (scratchpad/polygon-arsenal.log). Useful to synthesis as PEER-CORROBORATION context: a
 * single-name flow/technical signal is stronger when its peer group is moving with it and weaker when
 * the name is isolated.
 *
 * WHY a NEW provider file (not an edit to the huge polygon.ts): mirrors the standalone
 * polygon-options-gex.ts / polygon-macro.ts pattern — own BASE/KEY + the SAME governed request path
 * (polygonTrackedFetch: cluster rate-limiter + circuit breaker + api-usage tracking) + serverCache.
 * Governance stays in-path. No composer/ecosystem-context edits (that wiring is Track A's).
 *
 * HONESTY: the peer list is exactly what Polygon returns, de-duplicated and self-excluded; empty when
 * the upstream has none. Nothing is inferred or padded.
 */
import { polygonTrackedFetch } from "./polygon-rate-limiter";
import { polygonConfigured } from "./config";
import { serverCache, TTL } from "@/lib/server-cache";

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = process.env.POLYGON_API_KEY ?? "";

/** Governed GET — identical rate-limiter/breaker/tracking path as polygon.ts's private polygonGet. */
async function relatedGet<T>(path: string): Promise<T> {
  if (!polygonConfigured()) throw new Error("POLYGON_API_KEY not set");
  const qs = new URLSearchParams({ apiKey: KEY });
  const res = await polygonTrackedFetch(path, `${BASE}${path}?${qs}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 429) throw new Error(`Polygon ${path} → 429 (rate limited)`);
  if (!res.ok) throw new Error(`Polygon ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export type RelatedCompanies = {
  ticker: string;
  /** Peer tickers Polygon associates with `ticker` — uppercased, de-duplicated, self excluded. */
  related: string[];
};

/** Valid US equity symbol: 1–6 A–Z/. chars (covers BRK.B-style dotted tickers). */
const SYMBOL_RE = /^[A-Z][A-Z.]{0,5}$/;

/**
 * Pure: normalize raw `/v1/related-companies` results into a clean peer list. Uppercases, keeps only
 * plausible symbols, drops the query ticker itself, and de-duplicates while preserving Polygon's order
 * (their ordering carries a rough relatedness ranking).
 */
export function parseRelatedCompanies(
  ticker: string,
  results: Array<{ ticker?: unknown }> | undefined | null
): RelatedCompanies {
  const self = ticker.toUpperCase();
  const seen = new Set<string>();
  const related: string[] = [];
  for (const row of results ?? []) {
    const raw = typeof row?.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
    if (!raw || raw === self || seen.has(raw) || !SYMBOL_RE.test(raw)) continue;
    seen.add(raw);
    related.push(raw);
  }
  return { ticker: self, related };
}

/**
 * Fetch the peer set for a ticker. Cached per-name on the 1h REFERENCE tier (peer relationships change
 * rarely). Returns null only when Polygon is unconfigured or the upstream call fails; a real response
 * with an empty peer list returns `{ ticker, related: [] }` (honest "no peers", distinct from an error).
 */
export async function fetchRelatedCompanies(ticker: string): Promise<RelatedCompanies | null> {
  if (!polygonConfigured()) return null;
  const sym = ticker.toUpperCase();
  try {
    return await serverCache<RelatedCompanies>(`polygon:related-companies:v1:${sym}`, TTL.REFERENCE, async () => {
      const data = await relatedGet<{ results?: Array<{ ticker?: unknown }> }>(
        `/v1/related-companies/${encodeURIComponent(sym)}`
      );
      return parseRelatedCompanies(sym, data.results);
    });
  } catch {
    return null;
  }
}
