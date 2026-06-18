import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireAdminApi, getAdminApiActor } from "@/lib/admin-access";
import { readCodebaseScannedAt } from "@/lib/admin-endpoint-registry";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const execFileAsync = promisify(execFile);

export async function POST() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const actor = await getAdminApiActor();

  try {
    await execFileAsync("node", ["scripts/analyze-api-usage.mjs"], {
      cwd: process.cwd(),
      timeout: 45_000,
    });
    const scanned_at = readCodebaseScannedAt();
    void logAdminAction({
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
      action: "api_rescan",
      detail: { scanned_at },
    });
    return NextResponse.json({
      ok: true,
      scanned_at,
      message: "Codebase scan complete. Dashboard will reflect new endpoints on next refresh.",
    });
  } catch (error) {
    recordAdminRouteError("admin/apis/rescan", error);
    return NextResponse.json({ error: "Rescan failed" }, { status: 502 });
  }
}
