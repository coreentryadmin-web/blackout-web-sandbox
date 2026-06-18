/**
 * Data provider policy — Polygon Advanced (unlimited) first; UW Advanced (rate-limited) for exclusives.
 *
 * Polygon subs: Options, Stocks, Indices, Benzinga.
 * UW-only: options flow alerts, dark pool, NOPE, market/sector/ETF tide, screeners, congress, etc.
 */
import { polygonConfigured, uwConfigured } from "./config";

export const PROVIDER_POLICY = {
  primary: "polygon" as const,
  flowExclusive: "unusual_whales" as const,
  polygonPlans: ["options_advanced", "stocks_advanced", "indices_advanced", "benzinga"] as const,
} as const;

/** True when Polygon should be tried before UW for chains, GEX, max pain, indices, news, technicals. */
export function preferPolygon(): boolean {
  return polygonConfigured();
}

/** True when UW is available for flow / microstructure endpoints with no Polygon equivalent. */
export function uwFlowAvailable(): boolean {
  return uwConfigured();
}

export function providerLabel(source: "polygon" | "unusual_whales" | "benzinga" | "finnhub" | "postgres"): string {
  return source;
}
