import { NextRequest, NextResponse } from "next/server";
import { fetchMarketFlowAlerts } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";
import { engineConfigured, fetchEngine } from "@/lib/engine";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Number(sp.get("limit") ?? 50);
  const ticker = sp.get("ticker") ?? undefined;
  const min_premium = Number(sp.get("min_premium") ?? 0) || undefined;

  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  if (ticker) qs.set("ticker", ticker);
  if (min_premium) qs.set("min_premium", String(min_premium));

  if (engineConfigured()) {
    try {
      const data = await fetchEngine<{ flows: unknown[]; count: number }>(
        `/flows/recent?${qs.toString()}`
      );
      return NextResponse.json({ source: "engine", flows: data.flows, count: data.count });
    } catch (error) {
      console.warn("[market/flows] engine fallback to UW:", error);
    }
  }

  if (!uwConfigured()) {
    return NextResponse.json(
      { error: "No flow source configured", flows: [], count: 0 },
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
