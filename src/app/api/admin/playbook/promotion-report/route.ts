import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchPlaybookPromotionReport } from "@/lib/admin-playbook-promotion";
import { parseAdminSinceDate } from "@/lib/admin-playbook-query";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/admin/playbook/promotion-report — on-demand OOS promotion evidence (#20b). */
export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const sinceParam = req.nextUrl.searchParams.get("since");
  const sinceParsed = parseAdminSinceDate(sinceParam);
  if (!sinceParsed.ok) {
    return NextResponse.json({ error: sinceParsed.error }, { status: 400 });
  }

  try {
    const report = await fetchPlaybookPromotionReport({ since_date: sinceParsed.value });
    return NextResponse.json(report, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    recordAdminRouteError("admin/playbook/promotion-report", error);
    return NextResponse.json({ error: "Failed to build promotion report" }, { status: 502 });
  }
}
