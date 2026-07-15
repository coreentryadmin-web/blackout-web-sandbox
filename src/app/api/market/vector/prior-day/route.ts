import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import {
  normalizeVectorTicker,
  isVectorTickerAllowed,
  isVectorIndexTicker,
  vectorPolygonMinuteSymbol,
} from "@/features/vector/lib/vector-ticker";
import { fetchIndexDailyBars, fetchStockDailyBars } from "@/lib/providers/polygon";
import { priorDayFromDailyBars, priorEtYmd } from "@/lib/providers/spx-session";
import { formatEtDate } from "@/features/nighthawk/lib/session";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prior-session OHLC (PDH / PDL / PDC) for the Vector chart's "Key levels" prior-day + floor-pivot
 * overlays. The chart fetches this once per ticker (only when a prior-day level is enabled) and
 * derives the lines/pivots client-side. Reuses `priorDayFromDailyBars`, which walks back to the most
 * recent COMPLETED session (skipping today's in-progress bar during RTH). Rounded at the data layer.
 *
 * `anchor` (optional, YYYY-MM-DD) is the ET session date the CHART is displaying
 * (fetchVectorSeedBars.sessionYmd). "Prior day" must be relative to the DISPLAYED session, not the
 * wall clock: on a weekend / pre-open the chart's latest session is Friday, and anchoring to real
 * "today" (Sat/Sun/Mon-pre-open) returned FRIDAY itself — the displayed session's own H/L/C — so
 * PDH/PDL sat on the displayed candles' own extremes and the pivots were computed from the session
 * being viewed. With the anchor, the walk-back returns the session strictly BEFORE the displayed
 * one (Thursday, in that example). During RTH the anchor equals today, so behavior is unchanged.
 * Absent/malformed anchor falls back to today (legacy callers keep working).
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: `Invalid ticker` }, { status: 400 });
  }
  const ticker = normalizeVectorTicker(rawTicker);

  // Displayed-session anchor (see the route doc above). Validated strictly; anything else is
  // ignored so a garbage param can never shift the walk-back.
  const rawAnchor = req.nextUrl.searchParams.get("anchor");
  const anchor =
    rawAnchor && /^\d{4}-\d{2}-\d{2}$/.test(rawAnchor) ? rawAnchor : undefined;

  // ~2 weeks of daily bars covers weekends/holidays so the prior completed session is always in range.
  const to = formatEtDate(new Date());
  const from = priorEtYmd(16);
  const sym = vectorPolygonMinuteSymbol(ticker); // I:SPX etc. for indices

  const bars = await (isVectorIndexTicker(ticker)
    ? fetchIndexDailyBars(sym, from, to)
    : fetchStockDailyBars(ticker, from, to)
  ).catch(() => []);

  // Passing undefined engages priorDayFromDailyBars' todayEtYmd() default — the legacy behavior.
  const { pdh, pdl, pdc } = priorDayFromDailyBars(bars, anchor);
  return NextResponse.json(roundFloats({ ticker, pdh, pdl, pdc }));
}
