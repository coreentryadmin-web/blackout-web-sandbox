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

  // ~2 weeks of daily bars covers weekends/holidays so the prior completed session is always in range.
  const to = formatEtDate(new Date());
  const from = priorEtYmd(16);
  const sym = vectorPolygonMinuteSymbol(ticker); // I:SPX etc. for indices

  const bars = await (isVectorIndexTicker(ticker)
    ? fetchIndexDailyBars(sym, from, to)
    : fetchStockDailyBars(ticker, from, to)
  ).catch(() => []);

  const { pdh, pdl, pdc } = priorDayFromDailyBars(bars);
  return NextResponse.json(roundFloats({ ticker, pdh, pdl, pdc }));
}
