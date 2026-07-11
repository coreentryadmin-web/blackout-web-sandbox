import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { dbConfigured, loadPlaybookInstanceStates } from "@/lib/db";
import { todayEt } from "@/lib/et-date";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/admin/playbook/fsm-today — read-only today's playbook FSM rows (F4 RTH proof). */
export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  if (!dbConfigured()) {
    return NextResponse.json({ available: false, reason: "database not configured" });
  }

  const sessionDate = req.nextUrl.searchParams.get("session") ?? todayEt();
  try {
    const instances = await loadPlaybookInstanceStates(sessionDate);
    return NextResponse.json(
      {
        available: true,
        session_date: sessionDate,
        as_of: new Date().toISOString(),
        instance_count: instances.length,
        instances,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    recordAdminRouteError("admin/playbook/fsm-today", error);
    return NextResponse.json({ error: "Failed to load playbook FSM rows" }, { status: 502 });
  }
}
