import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, getAdminApiActor } from "@/lib/admin-access";
import { buildEventDetail } from "@/lib/api-telemetry";
import { fetchPersistedApiEvent } from "@/lib/api-telemetry-persist";
import { logAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  let detail = buildEventDetail(params.id);
  if (!detail) {
    const persisted = await fetchPersistedApiEvent(params.id);
    if (persisted) {
      detail = {
        event: persisted,
        chain: [persisted],
        endpoint_stats: null,
        active_retry: null,
        diagnosis: [],
      };
    }
  }

  if (!detail) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const actor = await getAdminApiActor();
  void logAdminAction({
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    action: "api_event_view",
    detail: { event_id: params.id, provider: detail.event.provider },
  });

  return NextResponse.json(detail);
}
