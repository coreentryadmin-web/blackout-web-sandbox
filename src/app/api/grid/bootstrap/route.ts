import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { readGridBootstrapMarket } from "@/lib/grid/grid-market-bootstrap";
import { readGridBootstrapPanels } from "@/lib/providers/grid";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
};

/**
 * GET /api/grid/bootstrap — single response with Redis-backed Grid panel snapshots plus
 * market-route seeds (Pulse, GEX SPX, whale flow). Collapses staggered client fetches into
 * one round-trip so the board paints immediately.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;
  const locked = await requireToolApi("grid");
  if (locked) return locked;

  try {
    const [panels, market] = await Promise.all([readGridBootstrapPanels(), readGridBootstrapMarket()]);
    return NextResponse.json(roundFloats({ ...panels, market }), { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { as_of: new Date().toISOString(), panels: {} },
      { status: 200, headers: NO_STORE },
    );
  }
}
