import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { getLargoSessionMessages, largoConfigured } from "@/lib/largo-terminal";
import { requireToolApi } from "@/lib/tool-access-server";

export const dynamic = "force-dynamic";

/** Load persisted Largo conversation for the signed-in user. */
export async function GET(req: NextRequest) {
  const authResult = await requireTierApi("premium");
  if (authResult instanceof Response) return authResult;

  // Launch gate — locked to non-admins until this tool ships.
  const locked = await requireToolApi("largo");
  if (locked) return locked;

  if (!largoConfigured()) {
    return NextResponse.json({ error: "Largo not configured" }, { status: 503 });
  }

  const sessionId = req.nextUrl.searchParams.get("session_id")?.trim() ?? "";
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  try {
    const payload = await getLargoSessionMessages(sessionId, authResult.userId);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[market/largo/session]", error);
    return NextResponse.json({ error: "Failed to load session" }, { status: 502 });
  }
}
