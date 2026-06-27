import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const endpoint = req.nextUrl.searchParams.get("endpoint") ?? "/api/congress/recent-trades";
  const UW_BASE = process.env.UW_API_BASE ?? "https://api.unusualwhales.com";
  const UW_KEY = process.env.UW_API_KEY ?? process.env.UNUSUAL_WHALES_API_KEY ?? "";

  try {
    const url = `${UW_BASE}${endpoint}?limit=5`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${UW_KEY}`, "Content-Type": "application/json" },
    });
    const text = await r.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return NextResponse.json({ status: r.status, endpoint, raw: parsed });
  } catch (e) {
    return NextResponse.json({ error: String(e), endpoint });
  }
}
