import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { getVectorFlowMarkers } from "@/features/vector/lib/vector-flow-markers-server";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Options-flow markers scoped to a DTE horizon — the read behind the Vector chart's "Options flow"
 * overlay (feature #20). Returns the notable LARGE near-ATM option prints (strike + side + premium +
 * size + timestamp) so the client plots each one as a marker where big money hit relative to the
 * candles and gamma walls.
 *
 * Same gate as the sibling reads (authorizeMarketDeskApi + requireToolApi("vector") + ticker
 * allowlist). Kept off the per-second SSE payload (like walls / max-pain) so the shared stream stays
 * lean — the client fetches this once per ticker/DTE toggle (and on a slow poll while live). Floats
 * are rounded at the data layer per repo policy. `available:false` with an empty `prints` array is an
 * HONEST empty (Polygon not configured, no spot, no expiry, WS-only sandbox) — never fabricated flow.
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

  const res = await getVectorFlowMarkers(ticker, horizon);
  return NextResponse.json(roundFloats({ ticker, horizon, ...res }));
}
