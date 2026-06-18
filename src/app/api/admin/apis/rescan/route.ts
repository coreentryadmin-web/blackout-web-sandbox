import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireAdminApi } from "@/lib/admin-access";
import { readCodebaseScannedAt } from "@/lib/admin-endpoint-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const execFileAsync = promisify(execFile);

export async function POST() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    await execFileAsync("node", ["scripts/analyze-api-usage.mjs"], {
      cwd: process.cwd(),
      timeout: 45_000,
    });
    return NextResponse.json({
      ok: true,
      scanned_at: readCodebaseScannedAt(),
      message: "Codebase scan complete. Dashboard will reflect new endpoints on next refresh.",
    });
  } catch (error) {
    console.error("[admin/apis/rescan]", error);
    return NextResponse.json({ error: "Rescan failed" }, { status: 502 });
  }
}
