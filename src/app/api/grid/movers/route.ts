import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApiForDeskCaller } from "@/lib/tool-access-server";
import { polygonConfigured } from "@/lib/providers/config";
import { readGridMovers } from "@/lib/providers/grid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache" };

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;
  const locked = await requireToolApiForDeskCaller(auth, "grid");
  if (locked) return locked;
  if (!polygonConfigured()) return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
  try {
    const snapshot = await readGridMovers();
    if (!snapshot) return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
    return NextResponse.json({ available: true, ...snapshot }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
  }
}
