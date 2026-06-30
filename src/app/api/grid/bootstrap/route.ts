import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { readGridBootstrapPanels } from "@/lib/providers/grid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
};

/**
 * GET /api/grid/bootstrap — single response with all Redis-backed Grid panel snapshots.
 * Collapses 8 parallel client fetches into one round-trip so the board paints immediately.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;
  const locked = await requireToolApi("grid");
  if (locked) return locked;

  try {
    const payload = await readGridBootstrapPanels();
    return NextResponse.json(payload, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { as_of: new Date().toISOString(), panels: {} },
      { status: 200, headers: NO_STORE },
    );
  }
}
