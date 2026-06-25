import { polygonConfigured } from "./config";
import { polygonTrackedFetch } from "./polygon-rate-limiter";

type SpySnapshot = {
  ticker?: string;
  todaysChangePerc?: number;
  day?: { c?: number };
  prevDay?: { c?: number };
};

/**
 * SPY premarket gap vs prior close — best free proxy for overnight ES move on Polygon.
 * Polygon does not carry ES futures; SPX index can lag before cash open.
 */
export async function fetchSpyGapPct(): Promise<number | null> {
  if (!polygonConfigured()) return null;

  const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
  const KEY = process.env.POLYGON_API_KEY ?? "";
  if (!KEY) return null;

  try {
    const qs = new URLSearchParams({ tickers: "SPY", apiKey: KEY });
    const res = await polygonTrackedFetch(
      "/v2/snapshot/locale/us/markets/stocks/tickers",
      `${BASE}/v2/snapshot/locale/us/markets/stocks/tickers?${qs}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as { tickers?: SpySnapshot[] };
    const spy = data.tickers?.[0];
    if (!spy) return null;

    if (spy.todaysChangePerc != null && Number.isFinite(spy.todaysChangePerc)) {
      return Number(spy.todaysChangePerc.toFixed(3));
    }

    const prev = spy.prevDay?.c;
    const last = spy.day?.c;
    if (prev != null && last != null && prev > 0) {
      return Number((((last - prev) / prev) * 100).toFixed(3));
    }
    return null;
  } catch {
    return null;
  }
}

export function gapFromPrice(price: number, pdc: number | null): number | null {
  if (pdc == null || pdc <= 0 || price <= 0) return null;
  return Number((((price - pdc) / pdc) * 100).toFixed(3));
}

export type GapSnapshot = {
  gap_pct: number | null;
  gap_source: "SPY" | "SPX" | null;
};

/**
 * Pre-market: prefer SPY overnight gap. RTH: SPX vs prior close.
 */
export async function resolveDeskGap(input: {
  spx_price: number;
  prior_close: number | null;
  premarket: boolean;
}): Promise<GapSnapshot> {
  if (input.premarket) {
    const spyGap = await fetchSpyGapPct();
    if (spyGap != null) {
      return { gap_pct: spyGap, gap_source: "SPY" };
    }
  }

  const spxGap = gapFromPrice(input.spx_price, input.prior_close);
  return {
    gap_pct: spxGap,
    gap_source: spxGap != null ? "SPX" : null,
  };
}
