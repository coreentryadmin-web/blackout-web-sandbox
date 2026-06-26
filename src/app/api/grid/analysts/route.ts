import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { polygonConfigured } from "@/lib/providers/config";
import { readGridAnalysts } from "@/lib/providers/grid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/grid/analysts — Analyst Actions panel (BlackOut Grid).
 *
 * CACHE-READER: reads the `grid:analysts` Redis snapshot written by the `grid-warm` cron
 * (market-wide Benzinga analyst channel). On a cold cache it falls through to ONE deduped
 * upstream fetch via readGridAnalysts (uwCacheGet single-flight) — never a per-request stampede.
 *
 * GATED to `grid` (parity with gex-positioning): non-admins get the lock response until the Grid
 * ships. Returns { available:false } (200) on a cold/empty cache — never fabricated, never throws.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("grid");
  if (locked) return locked;

  const noStore = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  };

  if (!polygonConfigured()) {
    return NextResponse.json({ available: false }, { status: 200, headers: noStore });
  }

  try {
    const snapshot = await readGridAnalysts();
    if (!snapshot) {
      return NextResponse.json({ available: false }, { status: 200, headers: noStore });
    }
    return NextResponse.json({ available: true, ...snapshot }, { status: 200, headers: noStore });
  } catch (error) {
    console.error("[grid/analysts]", error);
    return NextResponse.json({ available: false }, { status: 200, headers: noStore });
  }
}
