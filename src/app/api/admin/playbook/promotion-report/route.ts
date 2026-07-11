import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchPlaybookPromotionReport } from "@/lib/admin-playbook-promotion";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/admin/playbook/promotion-report — on-demand OOS promotion evidence (#20b). */
export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const since = req.nextUrl.searchParams.get("since") ?? undefined;
  try {
    const report = await fetchPlaybookPromotionReport({ since_date: since });
    return NextResponse.json(report, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    recordAdminRouteError("admin/playbook/promotion-report", error);
    return NextResponse.json({ error: "Failed to build promotion report" }, { status: 502 });
  }
}
