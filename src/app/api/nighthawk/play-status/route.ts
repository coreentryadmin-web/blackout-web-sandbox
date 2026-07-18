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
//   { available: false }  — no morning-confirm run has fired yet for this date (200; expected state)
//   MorningConfirmResult  — the full status blob including per-play CONFIRMED/DEGRADED/INVALIDATED

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { makeRedis } from "@/lib/make-redis";
import { todayEt } from "@/features/nighthawk/lib/session";
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
      // 200, not 404: "not yet run" is the EXPECTED state for every request before the 9:15am ET
      // cron fires (and all evening/overnight once the date param rolls to the next ET day), so a
      // 404 here printed a red console error on every Night Hawk pane load ~15 hours a day. The
      // body already carried the honest `available:false` + reason; the only caller
      // (fetchNightHawkPlayStatus) mapped !ok to a reason-less `{available:false}`, so returning
      // 200 hands it strictly more information. True error states below keep error codes.
      return NextResponse.json(
        { available: false, date, reason: "Morning confirmation not yet run for this date" },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    const result = JSON.parse(raw) as MorningConfirmResult;
    return NextResponse.json(
      { available: true, ...result },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    // Log the real exception server-side only. Unlike the cron-gated routes with this same
    // anti-pattern, this route is reachable by ANY signed-in premium member (authorizeCronOrTierApi
    // gates on tier, not admin/cron) -- a Redis failure or malformed cached blob's raw message can
    // embed internal detail (e.g. ECS service-discovery hostnames, driver connection-error text)
    // that must never reach a regular member's browser. Same "log raw, return fixed string"
    // pattern established in /api/ready (task #66).
    const error = err instanceof Error ? err.message : String(err);
    console.error("[nighthawk/play-status] error:", error);
    return NextResponse.json(
      { available: false, error: "Status temporarily unavailable" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  } finally {
    await redis?.quit().catch(() => undefined);
  }
}
