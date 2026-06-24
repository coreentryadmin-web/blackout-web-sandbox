// Admin status for the Night's Watch options WebSocket (live option marks).
// Lets an operator verify the engine is enabled, connected, authenticated, and
// streaming the union of held contracts — without digging through Railway logs.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { getOptionsSocketStatus } from "@/lib/ws/options-socket";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  // Boot the lazy-init sockets if they haven't started yet, so hitting this route
  // is itself a reliable way to bring the engine up + report its live state.
  ensureDataSockets();

  return NextResponse.json(getOptionsSocketStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
