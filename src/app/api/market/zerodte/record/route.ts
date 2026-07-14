// GET /api/market/zerodte/record — the 0DTE Command multi-day track record (P-3).
// Same auth/gating as the board route (this is the same product surface, read-only),
// same window convention as /api/market/nighthawk/record (?days=N, default 30, cap 90).
// All aggregation math lives in src/lib/zerodte/record.ts (pure, unit-tested); this
// route only fetches ledger rows and shapes the response.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchZeroDteSetupLogRange, requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { buildZeroDteRecord } from "@/lib/zerodte/record";
import { formatEtDate, todayEt } from "@/features/nighthawk/lib/session";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
} as const;

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
// Row budget: the scanner ledger caps out well under 15 committed rows/session in
// practice (10 setups/scan, one row per session+ticker), so days*20 with a hard
// ceiling comfortably covers the window without an unbounded fetch.
const MAX_ROWS = 2000;

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  if (authResult.via === "user") {
    // 0DTE Command lives on /nighthawk behind Night Hawk's launch gate — same
    // gating decision as the board route (see its comment).
    const nighthawkDenied = await requireToolApi("nighthawk");
    if (nighthawkDenied) return nighthawkDenied;
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS) || DEFAULT_DAYS)
  );
  const through = todayEt();
  const since = formatEtDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  try {
    const rows = await fetchZeroDteSetupLogRange(since, Math.min(MAX_ROWS, days * 20));
    const record = buildZeroDteRecord(rows, { since, through, days });
    // Numbers are rounded at the data layer (record.ts); roundFloats is the same
    // response-boundary backstop every other market endpoint ships with.
    return NextResponse.json(roundFloats(record), { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/zerodte/record]", error);
    return NextResponse.json(
      { available: false, degraded: true },
      { headers: NO_STORE_HEADERS }
    );
  }
}
