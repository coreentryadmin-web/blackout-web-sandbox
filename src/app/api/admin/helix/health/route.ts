// GET /api/admin/helix/health — small, dedicated, read-only status endpoint for
// AdminBieDashboard's "HELIX health" panel (task #134). Same shape/contract as
// /api/admin/gex/health and /api/admin/zerodte/health: requireAdminApi() only — no
// actor/audit logging, because this route never performs an admin ACTION, it only
// reads (see src/lib/admin-helix-health.ts's module doc for the full read-only
// proof of every leg it pulls from) — roundFloats on the JSON body (systemic
// float-rounding convention, see CLAUDE.md's "Data-correctness notes learned"), and
// a 502 fail-closed on anything that escapes fetchHelixHealthSnapshot's own
// per-leg try/catch (that function's `errors` field already reports partial
// failures with a 200, same contract as its siblings).
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchHelixHealthSnapshot } from "@/lib/admin-helix-health";
import { roundFloats } from "@/lib/round-floats";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const snapshot = await fetchHelixHealthSnapshot();
    return NextResponse.json(roundFloats(snapshot), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    recordAdminRouteError("admin/helix/health", error);
    return NextResponse.json({ error: "Failed to load HELIX health snapshot" }, { status: 502 });
  }
}
