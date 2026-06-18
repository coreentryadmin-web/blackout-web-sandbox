import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, getAdminApiActor } from "@/lib/admin-access";
import { ackAdminIncident, listOpenAdminIncidents, resolveAdminIncident } from "@/lib/admin-incidents";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const incidents = await listOpenAdminIncidents(30);
    return NextResponse.json({ incidents, generated_at: new Date().toISOString() });
  } catch (error) {
    recordAdminRouteError("admin/incidents", error);
    return NextResponse.json({ error: "Failed to load incidents" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const body = (await req.json()) as { id?: string; action?: "ack" | "resolve" };
    if (!body.id || !body.action) {
      return NextResponse.json({ error: "id and action required" }, { status: 400 });
    }

    const actor = await getAdminApiActor();
    let ok = false;
    if (body.action === "ack") {
      ok = await ackAdminIncident(body.id, actor?.email ?? null);
    } else {
      ok = await resolveAdminIncident(body.id);
    }

    if (!ok) return NextResponse.json({ error: "Incident not found or already closed" }, { status: 404 });

    void logAdminAction({
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
      action: `incident_${body.action}`,
      detail: { incident_id: body.id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    recordAdminRouteError("admin/incidents", error);
    return NextResponse.json({ error: "Incident action failed" }, { status: 502 });
  }
}
