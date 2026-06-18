import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { buildAdminHealthSnapshot } from "@/lib/admin-health";
import { maybeAlertCriticalIssues } from "@/lib/admin-critical-alerts";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const health = await buildAdminHealthSnapshot();
    await maybeAlertCriticalIssues(health.issues);
    return NextResponse.json(health);
  } catch (error) {
    recordAdminRouteError("admin/health", error);
    return NextResponse.json({ error: "Failed to load admin health" }, { status: 502 });
  }
}
