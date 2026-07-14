import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { getNighthawkMetrics } from "@/features/nighthawk/lib/analytics";
import { buildNighthawkDebriefReport } from "@/features/nighthawk/lib/debrief-aggregate";

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
    // PR-N10: the full debrief report rides on this route (not a new one) — the admin
    // dashboard already reads it, the auth surface already exists, and the improvement
    // queue / gate counterfactuals are ops evidence about thresholds (admin material;
    // the member record route carries only the compact summary). Fetched in parallel;
    // buildNighthawkDebriefReport is fail-soft (an outage degrades to available:false,
    // never a 502 for the metrics half).
    const [metrics, debriefReport] = await Promise.all([
      getNighthawkMetrics(windowDays),
      buildNighthawkDebriefReport({ days: windowDays, nowMs: Date.now() }),
    ]);
    return NextResponse.json({ ...metrics, debrief_report: debriefReport }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/analytics", error);
    return NextResponse.json({ error: "Failed to load Night Hawk analytics" }, { status: 502 });
  }
}
