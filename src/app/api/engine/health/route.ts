import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { engineConfigured, fetchEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  if (!engineConfigured()) {
      return NextResponse.json({
      ok: false,
      engine: "missing",
      message: "Engine API not configured",
    });
  }

  try {
    await fetchEngine("/health");
    return NextResponse.json({ ok: true, engine: "online" });
  } catch {
    return NextResponse.json({ ok: false, engine: "offline" }, { status: 502 });
  }
}
