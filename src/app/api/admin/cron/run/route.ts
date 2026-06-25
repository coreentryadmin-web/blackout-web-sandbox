import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
// The dispatch table + synthetic-authorized invocation live in cron-dispatch.ts so the
// staleness watchdog's self-heal can share the EXACT same safe/idempotent handler set.
import {
  dispatchCronWarm,
  DISPATCHABLE_CRONS,
  isDispatchableCron,
} from "@/lib/cron-dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPPORTED = DISPATCHABLE_CRONS;

/**
 * Admin-triggered manual cron run/warm. Operational stopgap for when Railway's per-cron
 * trigger services are down: an admin can warm the stale crons from the browser. Auth is
 * the SAME admin gate as the rest of /api/admin (requireAdminApi → 401/403); CRON_SECRET is
 * never required from the caller — we attach it server-side to the synthetic cron request.
 *
 * POST body: { name: string }  e.g. "nights-watch-warm" | "flow-ingest" | "uw-cache-refresh" | "heatmap-warm"
 * Returns:   { ok, name, ranAt, durationMs, status, result }
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  let name: unknown;
  try {
    const body = await req.json();
    name = (body as { name?: unknown })?.name;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body — expected { name: string }" },
      { status: 400 }
    );
  }

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { ok: false, error: "Missing 'name' — expected a cron id string", supported: SUPPORTED },
      { status: 400 }
    );
  }

  const key = name.trim();
  if (!isDispatchableCron(key)) {
    return NextResponse.json(
      { ok: false, error: `Unknown cron '${key}'`, supported: SUPPORTED },
      { status: 400 }
    );
  }

  try {
    const dispatch = await dispatchCronWarm(key);

    // Map the dispatch result to this route's existing HTTP contract:
    //   CRON_SECRET missing → 503, downstream handler non-ok → 502, dispatch ok → 200.
    if (!dispatch.ok && dispatch.status === 503) {
      return NextResponse.json(
        { ok: false, name: dispatch.name, error: dispatch.error },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        ok: dispatch.ok,
        name: dispatch.name,
        ranAt: dispatch.ranAt,
        durationMs: dispatch.durationMs,
        status: dispatch.status,
        result: dispatch.result,
        ...(dispatch.error ? { error: dispatch.error } : {}),
        ...(dispatch.detail ? { detail: dispatch.detail } : {}),
      },
      { status: dispatch.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    // dispatchCronWarm never throws, but keep the route's defensive 500 contract intact.
    recordAdminRouteError("admin/cron/run", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        name: key,
        ranAt: new Date().toISOString(),
        durationMs: 0,
        error: "Cron run failed",
        detail,
      },
      { status: 500 }
    );
  }
}
