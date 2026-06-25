import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

// Reuse the EXACT cron handlers — do NOT reimplement any warming/ingest logic here.
// Each cron route exports a `GET(req: NextRequest)` that gates on `isCronAuthorized(req)`
// (Bearer CRON_SECRET) and then runs its job. We invoke those handlers directly with a
// synthetic, server-side-authorized request so an ADMIN can warm a cron from the browser
// WITHOUT ever holding CRON_SECRET (it stays in process.env, never exposed to the client).
import { GET as flowIngestGet } from "@/app/api/cron/flow-ingest/route";
import { GET as uwCacheRefreshGet } from "@/app/api/cron/uw-cache-refresh/route";
import { GET as nightsWatchWarmGet } from "@/app/api/cron/nights-watch-warm/route";
import { GET as heatmapWarmGet } from "@/app/api/cron/heatmap-warm/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CronHandler = (req: NextRequest) => Promise<Response>;

/**
 * Dispatch table: cron id → { handler, force }. `force` adds `?force=1` so the
 * market-hours-gated warmers actually run when an admin triggers them off-window
 * (the whole point of the manual stopgap). Keys mirror cron-registry.ts.
 */
const CRON_HANDLERS: Record<string, { handler: CronHandler; force: boolean }> = {
  "flow-ingest": { handler: flowIngestGet, force: false },
  "uw-cache-refresh": { handler: uwCacheRefreshGet, force: false },
  "nights-watch-warm": { handler: nightsWatchWarmGet, force: true },
  "heatmap-warm": { handler: heatmapWarmGet, force: true },
};

const SUPPORTED = Object.keys(CRON_HANDLERS);

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
  const entry = CRON_HANDLERS[key];
  if (!entry) {
    return NextResponse.json(
      { ok: false, error: `Unknown cron '${key}'`, supported: SUPPORTED },
      { status: 400 }
    );
  }

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Without CRON_SECRET the synthetic request can't pass isCronAuthorized — surface a
    // clear ops error rather than letting the handler return an opaque 401.
    return NextResponse.json(
      { ok: false, name: key, error: "CRON_SECRET not configured on this deployment" },
      { status: 503 }
    );
  }

  // Build a synthetic, authorized cron request: same Bearer auth + (for the warmers) ?force=1
  // so the handler runs identically to a real Railway cron fire. The host is arbitrary; the
  // cron handlers only read the Authorization header and the `force` query param.
  const url = entry.force
    ? `https://internal.local/api/cron/${key}?force=1`
    : `https://internal.local/api/cron/${key}`;
  const cronReq = new NextRequest(url, {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
  });

  const started = Date.now();
  try {
    const res = await entry.handler(cronReq);
    const durationMs = Date.now() - started;

    let result: unknown = null;
    try {
      result = await res.clone().json();
    } catch {
      result = await res.clone().text();
    }

    return NextResponse.json(
      {
        ok: res.ok,
        name: key,
        ranAt: new Date(started).toISOString(),
        durationMs,
        status: res.status,
        result,
      },
      { status: res.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    recordAdminRouteError("admin/cron/run", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        name: key,
        ranAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        error: "Cron run failed",
        detail,
      },
      { status: 500 }
    );
  }
}
