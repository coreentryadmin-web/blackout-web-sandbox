import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";
import { fetchMarketFlowAlerts } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";
import { maybeRunFlowIngest } from "@/lib/providers/flow-ingest";
import { marketPlatform } from "@/lib/platform";
import { serverCache, TTL } from "@/lib/server-cache";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { getGexPositioning } from "@/lib/providers/gex-positioning";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GEX proximity helpers
// ---------------------------------------------------------------------------

/** Within 0.5% of a level — covers roughly ±2 strikes for SPX/SPY/single-names. */
function isNear(strike: number, level: number | null): boolean {
  if (level == null || !Number.isFinite(level) || level === 0) return false;
  return Math.abs(strike - level) / level < 0.005;
}

/** Within 0.15% — "at" rather than merely "near". */
function isAt(strike: number, level: number | null): boolean {
  if (level == null || !Number.isFinite(level) || level === 0) return false;
  return Math.abs(strike - level) / level < 0.0015;
}

type GexProximityLabel =
  | "at_gamma_flip"
  | "at_call_wall"
  | "at_put_wall"
  | "near_call_wall"
  | "near_put_wall";

function computeGexProximity(
  strike: number,
  flip: number | null,
  callWall: number | null,
  putWall: number | null,
): GexProximityLabel | null {
  if (isAt(strike, flip))       return "at_gamma_flip";
  if (isAt(strike, callWall))   return "at_call_wall";
  if (isAt(strike, putWall))    return "at_put_wall";
  if (isNear(strike, callWall)) return "near_call_wall";
  if (isNear(strike, putWall))  return "near_put_wall";
  return null;
}
// nodejs runtime is required: ensureDataSockets (and the pg/UW providers used below)
// pull node-only modules (ioredis / ws / node:crypto) that the edge runtime rejects.
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  // Boot the UW WebSocket (idempotent) so a replica that only ever serves the /flows
  // poll route still initializes uwSocket and keeps the live tape fed (audit gap #4).
  ensureDataSockets();

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 500), 1000); // cap at 1000 to keep payload lean
  const ticker = sp.get("ticker") ?? undefined;
  const min_premium = Number(sp.get("min_premium") ?? 0) || undefined;
  // §3.5: clamp 1h–720h (30-day ceiling) so a caller can't pass since_hours=10000000 and scan the
  // entire flow_alerts table (+ mint a distinct cache key per value). limit is already capped at 1000.
  const since_hours = Math.min(Math.max(Number(sp.get("since_hours") ?? 168) || 168, 1), 720);

  if (dbConfigured()) {
    maybeRunFlowIngest().catch((err) => console.error("[flows] lazy ingest error:", err));
    const cacheKey = `flows:pg:${since_hours}:${min_premium ?? 0}:${ticker ?? "all"}`;
    try {
      const payload = await serverCache(cacheKey, TTL.DARK_POOL, async () => {
        const [flows, platform] = await Promise.all([
          // HELIX REAL-TIME TAPE → recency-ordered (P0): the LIMIT must keep the NEWEST
          // prints, not the top-N-by-premium that the client then reshuffles by time (which
          // made a "REAL-TIME TAPE" show old whale prints pinned to row 0). The premium
          // ordering still serves every other caller via the "premium" default. The tape
          // page's right-column rollups (Net Premium leaderboard, momentum, sector split)
          // aggregate this same recent-window set and re-rank by premium internally.
          fetchRecentFlows({ limit, ticker, min_premium, since_hours, order: "recent" }),
          Promise.all([
            marketPlatform.spx.getSpxDeskSummary().catch(() => null),
            marketPlatform.nighthawk.getLatestNightHawkSummary().catch(() => null),
          ]).then(([spx, nighthawk]) => ({ spx, nighthawk })),
        ]);

        // GEX proximity enrichment — cache-reader, no upstream pressure.
        // Fetch positioning for each distinct ticker in parallel (best-effort: a failure
        // leaves the flow row unannotated, never throws). Cap at 30 unique tickers to
        // bound latency on large result sets with many single names.
        const uniqueTickers = [...new Set(flows.map((f: { ticker: string }) => f.ticker))].slice(0, 30) as string[];
        const gexMap = new Map<string, { flip: number | null; call_wall: number | null; put_wall: number | null }>();
        await Promise.all(
          uniqueTickers.map(async (t) => {
            try {
              const pos = await getGexPositioning(t);
              if (pos) gexMap.set(t, { flip: pos.flip, call_wall: pos.call_wall, put_wall: pos.put_wall });
            } catch { /* best-effort */ }
          })
        );
        const enrichedFlows = flows.map((f: { ticker: string; strike: number }) => {
          const gex = gexMap.get(f.ticker);
          if (!gex) return f;
          const proximity = computeGexProximity(f.strike, gex.flip, gex.call_wall, gex.put_wall);
          if (!proximity) return f;
          return { ...f, gex_proximity: proximity };
        });

        console.log(`[market/flows] postgres ok — ${flows.length} rows (min_premium=${min_premium}, since_hours=${since_hours})`);
        return { source: "postgres" as const, flows: enrichedFlows, count: enrichedFlows.length, platform_refs: platform };
      });
      return NextResponse.json(payload);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[market/flows] postgres ERROR:", detail);
      return NextResponse.json({ source: "postgres_error", flows: [], count: 0, error: "Flow fetch failed" }, { status: 503 });
    }
  }

  if (!uwConfigured()) {
    return NextResponse.json(
      { error: "No flow source configured — set DATABASE_URL or UW_API_KEY", flows: [], count: 0 },
      { status: 503 }
    );
  }

  try {
    const cacheKey = `flows:uw:${limit}:${ticker ?? "all"}:${min_premium ?? 0}`;
    const flows = await serverCache(cacheKey, TTL.DARK_POOL, () =>
      fetchMarketFlowAlerts({ limit, ticker, min_premium })
    );
    return NextResponse.json({ source: "unusual_whales", flows, count: flows.length });
  } catch (error) {
    console.error("[market/flows]", error);
    return NextResponse.json({ error: "Flow fetch failed" }, { status: 503 });
  }
}
