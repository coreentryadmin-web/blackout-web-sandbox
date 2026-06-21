import { NextResponse } from "next/server";
import { getAdminStatus, requireAdminApi } from "@/lib/admin-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const status = await getAdminStatus();
  return NextResponse.json(status);
}
