// /api/market/zerodte/calibration — the gate-calibration evidence loop (PR-C).
//
// GET  → the CalibrationReport (src/lib/zerodte/calibration.ts): per-gate would-block
//        vs would-pass buckets + graduation recommendation, score-band records, and
//        blocked-value lines from counterfactually graded SKIPs. READ-ONLY — this
//        method never writes anything.
// POST ?grade_skips=1 → runs the bounded counterfactual skip-grader
//        (src/lib/zerodte/skip-grading.ts) over a date range (≤14 days) and reports
//        graded/ungradeable counts. This is the only write this route performs, and
//        it only ever fills NULL counterfactual_json cells (idempotent).
//
// ADMIN-GATED (both methods): this surface exists to decide gate POLICY (whether
// G-4/G-6 graduate to blocking member-visible commits) — it is a desk-operations
// instrument, not a member product, so it sits behind requireAdminApi like the
// other zerodte admin actions (admin/zerodte/regrade-index-roots), not behind the
// record route's premium-tier gate.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAdminApiActor, requireAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { buildZeroDteCalibrationReport } from "@/lib/zerodte/calibration";
import { runSkipGrading, MAX_SKIP_GRADE_DAYS } from "@/lib/zerodte/skip-grading";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The POST grader does one Polygon minute-bar fetch per (ticker, session) in the
// window — bounded, but slower than a pure read; give it the same headroom the
// regrade backfill route gets.
export const maxDuration = 120;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
} as const;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const days = Number(req.nextUrl.searchParams.get("days") ?? "") || undefined;
  try {
    const report = await buildZeroDteCalibrationReport({ days, nowMs: Date.now() });
    // Numbers are rounded at the data layer (calibration.ts); roundFloats is the
    // same response-boundary backstop every other market endpoint ships with.
    return NextResponse.json(roundFloats(report), { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/zerodte/calibration]", error);
    return NextResponse.json({ available: false, degraded: true }, { headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  // Explicit action flag — a bare POST does nothing, so a fat-fingered request can
  // never trigger the (bounded, idempotent, but Polygon-spending) grading run.
  if (req.nextUrl.searchParams.get("grade_skips") !== "1") {
    return NextResponse.json(
      { ok: false, error: "Pass ?grade_skips=1 to run the counterfactual skip-grader" },
      { status: 400 }
    );
  }

  let days: number | undefined;
  try {
    // Empty body = defaults; only malformed JSON that was actually sent is rejected
    // (same idiom as admin/zerodte/regrade-index-roots).
    const raw = await req.text();
    if (raw.trim().length > 0) {
      const body = JSON.parse(raw) as { days?: unknown };
      if (typeof body.days === "number" && Number.isFinite(body.days)) {
        days = Math.min(MAX_SKIP_GRADE_DAYS, Math.max(1, Math.trunc(body.days)));
      }
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const actor = await getAdminApiActor();
    const summary = await runSkipGrading({ days, nowMs: Date.now() });
    console.info(
      `[zerodte-skip-grading] since=${summary.since} scanned=${summary.scanned} graded=${summary.graded} ungradeable=${summary.ungradeable} errors=${summary.errors}`
    );
    void logAdminAction({
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
      action: "zerodte_grade_skips",
      detail: {
        days: days ?? MAX_SKIP_GRADE_DAYS,
        scanned: summary.scanned,
        graded: summary.graded,
        ungradeable: summary.ungradeable,
        errors: summary.errors,
      },
    });
    return NextResponse.json({ ok: true, ...roundFloats(summary) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/zerodte/calibration] grade_skips", error);
    return NextResponse.json({ ok: false, error: "Skip grading failed" }, { status: 502 });
  }
}
