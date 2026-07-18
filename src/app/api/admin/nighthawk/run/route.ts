import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { buildEveningEdition, serializeBuildError } from "@/features/nighthawk/lib/edition-builder";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Admin-triggered manual run of the Night Hawk edition pipeline. Same builder the
 * ECS cron hits — force-runs (bypasses the time window) and resumes the checkpointed
 * job. Admin-auth only (no CRON_SECRET needed). Capped at 800s/call to match the cron route
 * (was 300, which killed the build before its internal checkpoint budget could fire); a
 * long Claude build returns 202 mid-stage; click again to resume until job_status=published.
 */
export async function POST() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const result = await buildEveningEdition({ force: true });
    const status = result.ok ? 200 : result.job_status === "failed" ? 500 : 202;
    return NextResponse.json(
      {
        ...result,
        note:
          result.job_status === "published"
            ? "Edition published."
            : "Checkpointed pipeline — click Run again to resume until published.",
      },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/run", error);
    const detail = serializeBuildError(error);
    return NextResponse.json(
      { ok: false, error: "Edition build failed", detail },
      { status: 500 }
    );
  }
}
