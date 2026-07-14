import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { getNighthawkMetrics, type NighthawkRecordSegment } from "@/features/nighthawk/lib/analytics";
import type { NightHawkRecordSegmentWire } from "@/features/nighthawk/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
} as const;

const pct = (v: number) => Math.round(v * 1000) / 10;

function segmentWire(seg: NighthawkRecordSegment): NightHawkRecordSegmentWire {
  return {
    methodology: seg.methodology,
    label: seg.label,
    resolved: seg.resolved,
    scoreable: seg.scoreable,
    wins: seg.wins,
    losses: seg.losses,
    opens: seg.opens,
    ambiguous: seg.ambiguous,
    unfilled: seg.unfilled,
    pulled: seg.pulled,
    stop_data_unavailable: seg.stop_data_unavailable,
    win_rate_pct: seg.win_rate != null ? pct(seg.win_rate) : null,
    avg_return_pct: seg.avg_return_pct != null ? Math.round(seg.avg_return_pct * 100) / 100 : null,
    low_n: seg.low_n,
  };
}

/** User-facing Night Hawk track record — resolved play outcomes only.
 *
 *  PR-N2 record honesty: the headline ratios (win_rate_pct etc.) cover CURRENT-
 *  methodology scoreable rows only (analytics.ts computes them that way — this route
 *  adds nothing). Legacy-methodology rows are served as their own `segments.legacy`
 *  block, labeled, never blended: the pre-fix blend advertised 42.9% WR built on
 *  gap-away "wins" that were unfillable at the published entry band. */
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
      win_rate_pct: pct(metrics.win_rate),
      profitable_rate_pct: pct(metrics.profitable_rate),
      avg_return_pct: Math.round(metrics.avg_return_pct * 100) / 100,
      // PR-N2: the honest split — headline methodology tag, the ratio-denominator
      // exclusions as explicit counts, and both rule-set segments side by side.
      methodology: metrics.methodology,
      unfilled_count: metrics.unfilled_count,
      pulled_count: metrics.pulled_count,
      stop_data_unavailable_count: metrics.stop_data_unavailable_count,
      segments: {
        current: segmentWire(metrics.segments.current),
        legacy: segmentWire(metrics.segments.legacy),
      },
      by_conviction: metrics.by_conviction
        .filter((c) => c.n > 0)
        .map((c) => ({
          conviction: c.conviction,
          n: c.n,
          win_rate_pct: pct(c.win_rate),
          // Shared LOW-N discipline (zerodte/record.ts threshold) — consumers badge it.
          low_n: c.low_n,
        })),
      available: metrics.total_resolved > 0,
    },
    { headers: NO_STORE_HEADERS }
  );
}
