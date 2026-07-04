// GET /api/admin/spx/health — small, dedicated, read-only status endpoint for
// AdminBieDashboard's SPX health panel. Deliberately separate from
// /api/admin/bie-report (BIE-specific: interactions/calibration/discovery —
// SPX play-engine health doesn't belong there) and from the much heavier
// /api/admin/spx/dashboard (full analytics/lotto/power-hour/issues/terminal
// feed, meant for deep SPX debugging, not a compact status glance).
//
// Same admin-auth boilerplate as every other read-only admin GET (see
// /api/admin/bie-report/route.ts) — requireAdminApi() only, no actor/audit
// logging, because this route never performs an admin *action*, it only
// reads. See admin-spx-health.ts's module doc for the full read-only proof.
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchSpxHealthSnapshot } from "@/lib/admin-spx-health";
import { roundFloats } from "@/lib/round-floats";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const snapshot = await fetchSpxHealthSnapshot();
    return NextResponse.json(roundFloats(snapshot), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // fetchSpxHealthSnapshot() already catches every individual leg internally
    // and reports partial failures via its own `errors` field — reaching this
    // catch means something outside those guarded legs broke. Fail closed with
    // a 502 rather than a half-built JSON body; the panel's own fetch-error
    // state (AdminBieDashboard.tsx) renders "—" and never blanks the rest of
    // the dashboard.
    recordAdminRouteError("admin/spx/health", error);
    return NextResponse.json({ error: "Failed to load SPX health snapshot" }, { status: 502 });
  }
}
