import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchSpxAdminAnalytics } from "@/lib/admin-spx-analytics";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const analytics = await fetchSpxAdminAnalytics();
    return NextResponse.json(roundFloats(analytics));
  } catch (error) {
    recordAdminRouteError("admin/analytics/spx", error);
    return NextResponse.json({ error: "Failed to load SPX analytics" }, { status: 502 });
  }
}
