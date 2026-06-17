import { NextRequest, NextResponse } from "next/server";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";
import { fetchMarketFlowAlerts } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";
import { maybeRunFlowIngest } from "@/lib/providers/flow-ingest";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Number(sp.get("limit") ?? 50);
  const ticker = sp.get("ticker") ?? undefined;
  const min_premium = Number(sp.get("min_premium") ?? 0) || undefined;

  if (dbConfigured()) {
    void maybeRunFlowIngest();
    try {
      const flows = await fetchRecentFlows({ limit, ticker, min_premium });
      return NextResponse.json({ source: "postgres", flows, count: flows.length });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[market/flows] postgres:", detail);
    }
  }

  if (!uwConfigured()) {
    return NextResponse.json(
      { error: "No flow source configured — set DATABASE_URL or UW_API_KEY", flows: [], count: 0 },
      { status: 503 }
    );
  }

  try {
    const flows = await fetchMarketFlowAlerts({ limit, ticker, min_premium });
    return NextResponse.json({ source: "unusual_whales", flows, count: flows.length });
  } catch (error) {
    console.error("[market/flows]", error);
    return NextResponse.json({ error: "Flow fetch failed" }, { status: 502 });
  }
}
