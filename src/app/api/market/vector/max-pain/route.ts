import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { getVectorMaxPainForHorizon } from "@/features/vector/lib/vector-max-pain-server";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Max-pain strike scoped to a DTE horizon — the read behind the Vector chart's max-pain overlay.
 * Kept off the per-second SSE payload (like the walls / ladder routes) so the shared per-ticker
 * stream fan-out stays lean; the client fetches this once per ticker/DTE toggle and draws the line.
 *
 * Same gate as the sibling reads (authorizeMarketDeskApi + requireToolApi("vector") + ticker
 * allowlist). `maxPain` is a listed strike (already clean), `spot` is rounded at the data layer per
 * repo policy. `maxPain: null` when there's no honest level to draw (no chain / horizon / OI) — the
 * client simply omits the line.
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
  const horizon = normalizeDteHorizon(req.nextUrl.searchParams.get("dte"));

  const res = await getVectorMaxPainForHorizon(ticker, horizon);
  return NextResponse.json(
    roundFloats({
      ticker,
      horizon,
      maxPain: res?.maxPain ?? null,
      spot: res?.spot ?? null,
    })
  );
}
