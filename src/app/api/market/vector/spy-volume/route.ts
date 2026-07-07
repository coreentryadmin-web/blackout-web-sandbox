import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { fetchSpyVolumeRows } from "@/lib/vector-spy-volume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SPY 1m volume rows for Vector chart backfill when SSR seed missed the merge. */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const ymd = req.nextUrl.searchParams.get("ymd")?.trim();
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return NextResponse.json({ error: "ymd required (YYYY-MM-DD)" }, { status: 400 });
  }

  const volumes = await fetchSpyVolumeRows(ymd);
  return NextResponse.json({ ymd, volumes, available: volumes.length > 0 });
}
