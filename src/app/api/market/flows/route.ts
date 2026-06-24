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
          fetchRecentFlows({ limit, ticker, min_premium, since_hours }),
          Promise.all([
            marketPlatform.spx.getSpxDeskSummary().catch(() => null),
            marketPlatform.nighthawk.getLatestNightHawkSummary().catch(() => null),
          ]).then(([spx, nighthawk]) => ({ spx, nighthawk })),
        ]);
        console.log(`[market/flows] postgres ok — ${flows.length} rows (min_premium=${min_premium}, since_hours=${since_hours})`);
        return { source: "postgres" as const, flows, count: flows.length, platform_refs: platform };
      });
      return NextResponse.json(payload);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[market/flows] postgres ERROR:", detail);
      return NextResponse.json({ source: "postgres_error", flows: [], count: 0, error: detail }, { status: 503 });
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
