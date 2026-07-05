// GET /api/admin/zerodte/health — small, dedicated, read-only status endpoint for
// AdminBieDashboard's "0DTE Command health" panel. Direct analogue of task #111's
// /api/admin/spx/health — same boilerplate, same admin-gating, same fail-closed
// contract — applied to the SEPARATE multi-ticker 0DTE Command scanner (`/grid`'s
// default tab), not SPX Slayer's own engine (task #127's naming disambiguation).
//
// Same admin-auth boilerplate as every other read-only admin GET (see
// /api/admin/spx/health/route.ts) — requireAdminApi() only, no actor/audit
// logging, because this route never performs an admin *action*, it only reads.
// See admin-zerodte-health.ts's module doc for exactly where each of the 3
// surfaced metrics (last-scan-time, candidates-scanned, rejection-rate) comes from.
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchZeroDteHealthSnapshot } from "@/lib/admin-zerodte-health";
import { roundFloats } from "@/lib/round-floats";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const snapshot = await fetchZeroDteHealthSnapshot();
    return NextResponse.json(roundFloats(snapshot), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // fetchZeroDteHealthSnapshot() already catches every individual leg internally
    // and reports partial failures via its own `errors` field — reaching this
    // catch means something outside those guarded legs broke. Fail closed with
    // a 502 rather than a half-built JSON body; the panel's own fetch-error state
    // (AdminBieDashboard.tsx) renders "—" and never blanks the rest of the dashboard.
    recordAdminRouteError("admin/zerodte/health", error);
    return NextResponse.json({ error: "Failed to load 0DTE Command health snapshot" }, { status: 502 });
  }
}
