import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchSpxAdminDashboard } from "@/lib/admin-spx-dashboard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const live = req.nextUrl.searchParams.get("live") === "1";

  try {
    const dashboard = await fetchSpxAdminDashboard({ liveEngine: live });
    return NextResponse.json(dashboard);
  } catch (error) {
    console.error("[admin/spx/dashboard]", error);
    return NextResponse.json({ error: "Failed to load SPX dashboard" }, { status: 502 });
  }
}
