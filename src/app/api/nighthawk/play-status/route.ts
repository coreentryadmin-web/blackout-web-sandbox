// GET /api/nighthawk/play-status
//
// Returns the morning-confirmation status blob for the current (or requested) Night Hawk edition.
// Written by /api/cron/nighthawk-morning-confirm at 9:15am ET each trading day.
//
// Query params:
//   ?date=YYYY-MM-DD  — target edition date (defaults to today's ET date)
//
// Auth: premium tier (same gate as the edition route).
//
// Returns:
//   { available: false }  — no morning-confirm run has fired yet for this date (404)
//   MorningConfirmResult  — the full status blob including per-play CONFIRMED/DEGRADED/INVALIDATED

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { makeRedis } from "@/lib/make-redis";
import { todayEt } from "@/lib/nighthawk/session";
import type { MorningConfirmResult } from "@/app/api/cron/nighthawk-morning-confirm/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
} as const;

const REDIS_KEY = (date: string) => `nh:play-status:${date}`;

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const locked = await requireToolApi("nighthawk");
  if (locked) return locked;

  const date = req.nextUrl.searchParams.get("date") ?? todayEt();

  const redisUrl = process.env.REDIS_URL ?? "";
  if (!redisUrl) {
    return NextResponse.json(
      { available: false, reason: "Redis not configured" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  let redis: Awaited<ReturnType<typeof makeRedis>> | null = null;
  try {
    redis = await makeRedis("nighthawk-play-status", redisUrl, { maxRetriesPerRequest: 1 });
    const raw = await redis.get(REDIS_KEY(date));

    if (!raw) {
      return NextResponse.json(
        { available: false, date, reason: "Morning confirmation not yet run for this date" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const result = JSON.parse(raw) as MorningConfirmResult;
    return NextResponse.json(
      { available: true, ...result },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[nighthawk/play-status] error:", error);
    return NextResponse.json(
      { available: false, error },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  } finally {
    await redis?.quit().catch(() => undefined);
  }
}
