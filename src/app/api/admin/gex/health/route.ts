// GET /api/admin/gex/health — small, dedicated, read-only status endpoint for
// AdminBieDashboard's "Thermal health" panel (task #138). Same shape/contract as
// /api/admin/spx/health (task #111): requireAdminApi() only — no actor/audit logging,
// because this route never performs an admin ACTION, it only reads (see
// src/lib/admin-gex-health.ts's module doc for the full read-only proof of every leg it
// pulls from) — roundFloats on the JSON body (systemic float-rounding convention, see
// CLAUDE.md's "Data-correctness notes learned"), and a 502 fail-closed on anything that
// escapes fetchGexHealthSnapshot's own per-leg try/catch (that function's `errors` field
// already reports partial failures with a 200, same contract as admin-spx-health.ts).
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchGexHealthSnapshot } from "@/lib/admin-gex-health";
import { roundFloats } from "@/lib/round-floats";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const snapshot = await fetchGexHealthSnapshot();
    return NextResponse.json(roundFloats(snapshot), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    recordAdminRouteError("admin/gex/health", error);
    return NextResponse.json({ error: "Failed to load GEX health snapshot" }, { status: 502 });
  }
}
