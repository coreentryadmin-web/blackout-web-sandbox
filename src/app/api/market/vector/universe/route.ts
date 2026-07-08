import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { loadVectorUniverseSnapshot, refreshVectorUniverseSnapshot } from "@/features/vector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

/** Compact GEX wall summary for warmed universe tickers — pure cache-reader for Vector scanner. */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const force = req.nextUrl.searchParams.get("force") === "1";
  let snap = await loadVectorUniverseSnapshot();
  if (!snap || force) {
    snap = await refreshVectorUniverseSnapshot();
  }

  return NextResponse.json(snap, { headers: NO_STORE });
}
