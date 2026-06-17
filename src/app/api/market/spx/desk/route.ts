import { NextResponse } from "next/server";
import { deskCacheTtlMs } from "@/lib/providers/config";
import { buildSpxDesk } from "@/lib/providers/spx-desk";
import { withServerCache } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const desk = await withServerCache("spx-desk", deskCacheTtlMs(), buildSpxDesk);
    return NextResponse.json(desk);
  } catch (error) {
    console.error("[market/spx/desk]", error);
    return NextResponse.json({ available: false, error: "Desk build failed" }, { status: 502 });
  }
}
