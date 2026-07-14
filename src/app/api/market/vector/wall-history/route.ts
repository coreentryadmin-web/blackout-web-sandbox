import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { loadSessionWallHistory } from "@/features/vector/lib/vector-wall-persist";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recorded per-horizon bead trail for a session — the read behind the Vector chart's DTE toggle
 * showing FROZEN point-in-time clusters (not the single current column) for 0DTE/weekly/monthly.
 *
 * Why a dedicated read: the SSR seed (`page.tsx`) loads only the blended "all" rail
 * (`loadSessionWallHistory(sessionYmd, ticker)`); the narrowed horizons are recorded under their
 * own composite-keyed rails (`NVDA::weekly`, PR #186) but were never fetched client-side, so a
 * toggle to weekly/monthly could only draw the single current-structure column. This returns the
 * full recorded trail for the requested horizon so the chart draws the accumulated clusters — the
 * after-close analogue of the live rail, per the member ask "weekly & monthly should show the
 * call/put bead clusters, static after close, not single beads."
 *
 * `session` is the ET session date the chart is displaying (from `fetchVectorSeedBars`), passed so
 * the rail and the price bars describe the SAME session and align on the time axis. Absent/`"all"`
 * horizon short-circuits to an empty trail — the "all" rail is already SSR-seeded, and there is no
 * separate composite rail to read for it.
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
  const session = req.nextUrl.searchParams.get("session") ?? "";

  // "all" is already SSR-seeded from the bare-ticker rail; only narrowed horizons need this read.
  // A missing session can't be resolved to a rail here (the chart owns the displayed session date),
  // so return an empty trail and let the client fall back to the current-structure column.
  if (horizon === "all" || !session) {
    return NextResponse.json({ ticker, horizon, sessionYmd: session, history: [] });
  }

  const history = await loadSessionWallHistory(session, ticker, horizon).catch(() => []);
  return NextResponse.json({ ticker, horizon, sessionYmd: session, history });
}
