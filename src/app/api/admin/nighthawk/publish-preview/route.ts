import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { getNighthawkPublishPreview } from "@/lib/nighthawk/publish-preview";
import { normalizeIsoDateInput } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  // `edition_for` flows into `WHERE edition_for = $1::date`. A non-ISO value (e.g. the legacy
  // "Mon Jun 29" label) would make Postgres throw → a 502 + error-sink record for bad CLIENT input.
  // Reject it up front with a clean 400 instead (#77 Bug 1, inbound twin).
  const rawEditionFor = request.nextUrl.searchParams.get("edition_for")?.trim();
  let editionFor: string | undefined;
  if (rawEditionFor) {
    const normalized = normalizeIsoDateInput(rawEditionFor);
    if (!normalized) {
      return NextResponse.json(
        { error: "Invalid edition_for; expected YYYY-MM-DD" },
        { status: 400 }
      );
    }
    editionFor = normalized;
  }

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
