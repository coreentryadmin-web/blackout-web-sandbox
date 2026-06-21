import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";
import { fetchMarketFlowAlerts } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";
import { maybeRunFlowIngest } from "@/lib/providers/flow-ingest";
import { marketPlatform } from "@/lib/platform";
import { serverCache, TTL } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const sp = req.nextUrl.searchParams;
  const limit = Number(sp.get("limit") ?? 5000);
  const ticker = sp.get("ticker") ?? undefined;
  const min_premium = Number(sp.get("min_premium") ?? 0) || undefined;
  const since_hours = Number(sp.get("since_hours") ?? 48) || 48;

  if (dbConfigured()) {
    // Lazy side-effect: background ingest keeps Postgres fresh on read (cron also runs ingest).
    maybeRunFlowIngest().catch((err) => console.error("[flows] lazy ingest error:", err));
    try {
      const [flows, platform] = await Promise.all([
        fetchRecentFlows({ limit, ticker, min_premium, since_hours }),
        Promise.all([
          marketPlatform.spx.getSpxDeskSummary().catch(() => null),
          marketPlatform.nighthawk.getLatestNightHawkSummary().catch(() => null),
        ]).then(([spx, nighthawk]) => ({ spx, nighthawk })),
      ]);
      console.log(`[market/flows] postgres ok — ${flows.length} rows (min_premium=${min_premium}, since_hours=${since_hours})`);
      return NextResponse.json({
        source: "postgres",
        flows,
        count: flows.length,
        platform_refs: platform,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[market/flows] postgres ERROR:", detail);
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
    return NextResponse.json({ error: "Flow fetch failed" }, { status: 502 });
  }
}
