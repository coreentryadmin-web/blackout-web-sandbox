import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, getAdminApiActor } from "@/lib/admin-access";
import { fetchApiDashboard } from "@/lib/admin-api-dashboard";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const probe = req.nextUrl.searchParams.get("probe") === "1";
  const windowMin = Number(req.nextUrl.searchParams.get("window_min") ?? "5");
  const windowMs = Number.isFinite(windowMin) && windowMin > 0 ? windowMin * 60_000 : 5 * 60_000;

  try {
    const dashboard = await fetchApiDashboard({ probe, windowMs });
    if (probe) {
      const actor = await getAdminApiActor();
      void logAdminAction({
        actorUserId: actor?.userId,
        actorEmail: actor?.email,
        action: "api_probe_providers",
        detail: {
          providers_healthy: dashboard.summary.providers_healthy,
          providers_configured: dashboard.summary.providers_configured,
        },
      });
    }
    return NextResponse.json(dashboard);
  } catch (error) {
    recordAdminRouteError("admin/apis/dashboard", error);
    return NextResponse.json({ error: "Failed to load API dashboard" }, { status: 502 });
  }
}
