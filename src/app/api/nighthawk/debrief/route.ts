// GET /api/nighthawk/debrief
//
// Returns the automated end-of-session DEBRIEF blob for a Night Hawk session — what went well,
// the real winners, what misfired (and why), and the deterministic "how to improve"
// observations. Written by /api/cron/nighthawk-debrief after the 4:30pm ET outcomes grade.
//
// Query params:
//   ?date=YYYY-MM-DD  — target session date (defaults to today's ET date)
//
// Auth: premium tier (same gate as the edition / play-status routes).
//
// Returns:
//   { available: false }  — no debrief has been pinned yet for this date (200; expected state,
//                           same not-yet-run contract as /api/nighthawk/play-status)
//   { available: true, ...SessionDebrief }
//
// NOTE: the N11 SHADOW auto-tune observations (nh:tuning-observations:{date}) are deliberately
// NOT served here — they are an internal, human-review artifact, not member-facing. This route
// exposes only the member debrief blob.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { makeRedis } from "@/lib/make-redis";
import { todayEt } from "@/features/nighthawk/lib/session";
import type { SessionDebrief } from "@/features/nighthawk/lib/session-debrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
} as const;

const REDIS_KEY = (date: string) => `nh:debrief:${date}`;

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
    redis = await makeRedis("nighthawk-debrief-read", redisUrl, { maxRetriesPerRequest: 1 });
    const raw = await redis.get(REDIS_KEY(date));

    if (!raw) {
      // 200, not 404: "not yet run" is the EXPECTED state for every request before the ~5pm ET
      // debrief cron fires for a date (and all day for a future/holiday date). Same contract as
      // the play-status route — the honest available:false + reason hands the caller strictly
      // more than a bare 404 (which would also print a red console error on every pane load).
      return NextResponse.json(
        { available: false, date, reason: "Session debrief not yet run for this date" },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    // Optional fields on the blob so a legacy/older-version pin still deserializes cleanly.
    const result = JSON.parse(raw) as SessionDebrief;
    // Spread first, then force available:true — the pinned blob's own `available` reflects
    // whether THAT session had graded plays; a served pin is by definition available.
    return NextResponse.json({ ...result, available: true }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    // Log the real exception server-side only. This route is reachable by ANY signed-in premium
    // member (tier gate, not admin/cron), so a Redis failure's raw message can embed internal
    // detail (*.railway.internal hostnames, driver text) that must never reach a member browser.
    // Same "log raw, return fixed string" pattern as /api/nighthawk/play-status.
    const error = err instanceof Error ? err.message : String(err);
    console.error("[nighthawk/debrief] error:", error);
    return NextResponse.json(
      { available: false, error: "Debrief temporarily unavailable" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  } finally {
    await redis?.quit().catch(() => undefined);
  }
}
