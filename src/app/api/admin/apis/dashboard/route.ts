import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchApiDashboard } from "@/lib/admin-api-dashboard";
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
    return NextResponse.json(dashboard);
  } catch (error) {
    recordAdminRouteError("admin/apis/dashboard", error);
    return NextResponse.json({ error: "Failed to load API dashboard" }, { status: 502 });
  }
}
