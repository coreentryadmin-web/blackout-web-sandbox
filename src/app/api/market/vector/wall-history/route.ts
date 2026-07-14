import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { loadSessionWallHistory, loadRecentWallHistory } from "@/features/vector/lib/vector-wall-persist";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";

/** ISO session date (YYYY-MM-DD) guard — the `sessions` CSV is member-supplied, so reject anything
 *  that isn't a bare calendar date before it reaches the storage key / SQL ANY() bind. */
const SESSION_YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Hard cap on how many sessions one read may span — aligns with the candle seed window
 *  (TARGET_SEED_SESSIONS = 22) plus slack, so a crafted `sessions` list can't fan out unbounded. */
const MAX_SESSIONS = 24;

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
 * MULTI-SESSION (GAP A — multi-day bead/wall continuity): when the client passes `sessions` (a CSV
 * of the exact ET session dates the chart is displaying, from `fetchVectorSeedBars`), the read
 * returns the LATEST session at full resolution PLUS every PRIOR session decimated + tagged
 * `historical` (via `loadRecentWallHistory`) — so the narrowed-horizon rail shows yesterday's (and
 * older) clusters at their real prior-day timestamps, matching the "all" rail's multi-day seed.
 * `session` (single) stays the backward-compatible path for callers that only want one session.
 * Absent both / `"all"` horizon short-circuits to an empty trail — the "all" rail is already
 * SSR-seeded (multi-session), and there is no separate composite rail to read for it.
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
  // Optional multi-session window (GAP A): the exact displayed sessions, ascending. Validated,
  // de-duped, sorted, and capped so a crafted list can never fan out unbounded or inject a key.
  const sessions = [
    ...new Set(
      (req.nextUrl.searchParams.get("sessions") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => SESSION_YMD_RE.test(s))
    ),
  ]
    .sort()
    .slice(-MAX_SESSIONS);

  // "all" is already SSR-seeded (multi-session) from the bare-ticker rail; only narrowed horizons
  // need this read. With neither a session nor a sessions list we can't resolve a rail here (the
  // chart owns the displayed session dates), so return an empty trail and let the client fall back
  // to the current-structure column.
  if (horizon === "all" || (!session && !sessions.length)) {
    return NextResponse.json({ ticker, horizon, sessionYmd: session, history: [] });
  }

  // Prefer the multi-session read when the client passed the displayed window; else the single
  // session (backward compatible). loadRecentWallHistory returns latest-full + prior-decimated.
  const history = sessions.length
    ? await loadRecentWallHistory(ticker, horizon, sessions).catch(() => [])
    : await loadSessionWallHistory(session, ticker, horizon).catch(() => []);
  return NextResponse.json({ ticker, horizon, sessionYmd: session, sessions, history });
}
