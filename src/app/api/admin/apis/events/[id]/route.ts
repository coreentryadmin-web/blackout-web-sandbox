import { NextRequest, NextResponse } from "next/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { buildEventDetail } from "@/lib/api-telemetry";
import { fetchPersistedApiEvent } from "@/lib/api-telemetry-persist";
import { logAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  const { id } = await params;
  let detail = buildEventDetail(id);
  if (!detail) {
    const persisted = await fetchPersistedApiEvent(id);
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

  // actor was resolved above by resolveAdminApi()
  void logAdminAction({
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    action: "api_event_view",
    detail: { event_id: id, provider: detail.event.provider },
  });

  return NextResponse.json(detail);
}
