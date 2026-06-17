import { NextResponse } from "next/server";
import { fetchBenzingaNews } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!polygonConfigured()) {
    return NextResponse.json({ error: "POLYGON_API_KEY not configured", articles: [] }, { status: 503 });
  }

  try {
    const articles = await fetchBenzingaNews(15);
    return NextResponse.json({ source: "benzinga", articles });
  } catch (error) {
    console.error("[market/news]", error);
    return NextResponse.json({ error: "News fetch failed" }, { status: 502 });
  }
}
