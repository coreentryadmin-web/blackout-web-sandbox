import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { serverCache, TTL } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "SPY").toUpperCase().slice(0, 6);
  if (!/^[A-Z0-9.\-]{1,8}$/.test(symbol)) {
    return NextResponse.json({ snapshot: null, symbol }, { status: 400 });
  }

  try {
    const snapshot = await serverCache(
      `dark-pool:ticker:${symbol}`,
      TTL.DARK_POOL,
      async () => {
        const { fetchUwDarkPool } = await import("@/lib/providers/unusual-whales");
        return fetchUwDarkPool(symbol, { limit: 30 });
      }
    );

    if (!snapshot) {
      return NextResponse.json({ snapshot: null, symbol }, { status: 200 });
    }

    return NextResponse.json({ snapshot, symbol });
  } catch (err) {
    console.error("[dark-pool/ticker]", err);
    return NextResponse.json({ snapshot: null, symbol }, { status: 200 });
  }
}
