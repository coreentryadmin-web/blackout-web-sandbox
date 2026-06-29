import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { getNighthawkMetrics } from "@/lib/nighthawk/analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
} as const;

/** User-facing Night Hawk track record — resolved play outcomes only. */
export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const locked = await requireToolApi("nighthawk");
  if (locked) return locked;

  const windowDays = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days") ?? "30") || 30));
  const metrics = await getNighthawkMetrics(windowDays);

  return NextResponse.json(
    {
      window_days: metrics.window_days,
      total_resolved: metrics.total_resolved,
      pending_count: metrics.pending_count,
      win_rate_pct: Math.round(metrics.win_rate * 1000) / 10,
      profitable_rate_pct: Math.round(metrics.profitable_rate * 1000) / 10,
      avg_return_pct: Math.round(metrics.avg_return_pct * 100) / 100,
      by_conviction: metrics.by_conviction
        .filter((c) => c.n > 0)
        .map((c) => ({
          conviction: c.conviction,
          n: c.n,
          win_rate_pct: Math.round(c.win_rate * 1000) / 10,
        })),
      available: metrics.total_resolved > 0,
    },
    { headers: NO_STORE_HEADERS }
  );
}
