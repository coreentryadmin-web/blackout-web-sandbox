import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { buildEventDetail } from "@/lib/api-telemetry";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const detail = buildEventDetail(params.id);
  if (!detail) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
