import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { getNighthawkMetrics } from "@/lib/nighthawk/analytics";

export const dynamic = "force-dynamic";

function parseWindow(value: string | null): number {
  const parsed = Number.parseInt(value ?? "30", 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(180, Math.max(7, parsed));
}

export async function GET(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const windowDays = parseWindow(request.nextUrl.searchParams.get("window"));

  try {
    const metrics = await getNighthawkMetrics(windowDays);
    return NextResponse.json(metrics, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/analytics", error);
    return NextResponse.json({ error: "Failed to load Night Hawk analytics" }, { status: 502 });
  }
}
