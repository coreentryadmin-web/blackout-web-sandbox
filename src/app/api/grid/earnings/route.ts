import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { uwConfigured } from "@/lib/providers/config";
import { readGridEarnings } from "@/lib/providers/grid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache" };

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;
  const locked = await requireToolApi("grid");
  if (locked) return locked;
  if (!uwConfigured()) return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
  try {
    const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim() || undefined;
    const snapshot = await readGridEarnings();
    if (!snapshot) return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
    if (ticker && Array.isArray(snapshot.items)) {
      const filtered = snapshot.items.filter(
        (item: { ticker?: string }) => item.ticker?.toUpperCase() === ticker,
      );
      return NextResponse.json({ available: true, ...snapshot, items: filtered, ticker }, { status: 200, headers: NO_STORE });
    }
    return NextResponse.json({ available: true, ...snapshot }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
  }
}
