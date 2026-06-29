import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const endpoint = req.nextUrl.searchParams.get("endpoint") ?? "/api/congress/trades";
  const UW_BASE = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
  const UW_KEY = process.env.UW_API_KEY ?? "";
  const UW_CID = process.env.UW_CLIENT_API_ID ?? "100001";

  try {
    const url = `${UW_BASE}${endpoint}?limit=5`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${UW_KEY}`,
        "UW-CLIENT-API-ID": UW_CID,
        Accept: "application/json",
      },
    });
    const text = await r.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return NextResponse.json({ status: r.status, endpoint, raw: parsed });
  } catch (e) {
    return NextResponse.json({ error: String(e), endpoint });
  }
}
