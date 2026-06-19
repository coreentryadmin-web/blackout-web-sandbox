import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { getNighthawkPublishPreview } from "@/lib/nighthawk/publish-preview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const editionFor = request.nextUrl.searchParams.get("edition_for")?.trim() || undefined;

  try {
    const preview = await getNighthawkPublishPreview(editionFor);
    if (!preview) {
      return NextResponse.json({ error: "No edition found" }, { status: 404 });
    }
    return NextResponse.json(preview, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/publish-preview", error);
    return NextResponse.json({ error: "Failed to load publish preview" }, { status: 502 });
  }
}
