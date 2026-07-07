import { NextRequest, NextResponse } from "next/server";

import { requireTierApi } from "@/lib/market-api-auth";
import { anthropicConfigured } from "@/lib/providers/anthropic";
import { generateSpxCommentary, type SpxCommentaryResult } from "@/features/spx/lib/spx-commentary";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { serverCache } from "@/lib/server-cache";
import { sharedCacheGet } from "@/lib/shared-cache";

export const dynamic = "force-dynamic";

// All users see the same SPX market data — one Claude call per 5-minute window
// serves every connected session. First request in the window triggers the call;
// all others get the cached result instantly with zero additional cost.
//
// serverCache(cacheKey, COMMENTARY_TTL_MS) is the SOLE throttle/spend control for
// commentary: because the cache key is shared across all sessions and keyed by the
// 5-minute window slot, at most one Anthropic call happens per window platform-wide
// regardless of how many users/requests arrive. (A separate per-user interval/daily-cap
// module, src/lib/spx-commentary-limits.ts, was never wired in and has been removed —
// the shared-window cache already bounds spend more tightly than a per-user cap would.)
const COMMENTARY_TTL_MS = 5 * 60 * 1000;

type CommentaryCache = {
  commentary: SpxCommentaryResult;
  desk: SpxDeskPayload; // retained so next window can compute delta against it
};

export async function POST(req: NextRequest) {
  const authResult = await requireTierApi("premium");
  if (authResult instanceof Response) return authResult;

  if (!anthropicConfigured()) {
    return NextResponse.json({ error: "Commentary unavailable" }, { status: 503 });
  }

  // Body is optional — generation always uses the server-side merged desk.
  void req.json().catch(() => null);

  const now = Date.now();
  const windowSlot = Math.floor(now / COMMENTARY_TTL_MS);
  const cacheKey = `spx-commentary:shared:v2:${windowSlot}`;
  const prevKey = `server:spx-commentary:shared:v2:${windowSlot - 1}`;

  try {
    // Read previous window's cached desk from Redis for delta computation.
    // Direct Redis read — no side effects, no write.
    let prevDesk: SpxDeskPayload | null = null;
    try {
      const prev = await sharedCacheGet<CommentaryCache>(prevKey);
      prevDesk = prev?.desk ?? null;
    } catch {
      // Redis unavailable or key expired — no delta this window
    }

    const result = await serverCache<CommentaryCache>(cacheKey, COMMENTARY_TTL_MS, async () => {
      const { merged: desk } = await loadMergedSpxDesk();
      if (!desk.available || !(desk.price != null && desk.price > 0)) {
        throw new Error("spx-commentary: desk unavailable");
      }

      // Cross-tool access: give the desk AI the platform's OWN engine state (open play,
      // lotto, power-hour) + recent win-rate so its read aligns with the rest of the
      // platform (never contradicts an open position) and can calibrate conviction. All
      // read-only, fetched only on a cache miss (once per window); each falls back to null.
      const [openPlay, lotto, powerHour, outcomes] = await Promise.all([
        import("@/features/spx/lib/spx-play-store").then((m) => m.loadOpenPlay()).catch(() => null),
        import("@/features/spx/lib/spx-lotto-store").then((m) => m.loadLottoRecord()).catch(() => null),
        import("@/features/spx/lib/spx-power-hour-store").then((m) => m.loadPowerHourRecord()).catch(() => null),
        import("@/features/spx/lib/spx-play-outcomes").then((m) => m.fetchPlayOutcomeStats()).catch(() => null),
      ]);
      const commentary = await generateSpxCommentary(desk, prevDesk, { openPlay, lotto, powerHour, outcomes });
      // Throw (don't return null) on failure so serverCache's refreshCache skips its
      // .then store/Redis write and rethrows to us — nothing is negatively cached and
      // the next request retries immediately instead of being poisoned for the window.
      if (!commentary) throw new Error("spx-commentary: generation returned null");
      return { commentary, desk };
    });

    return NextResponse.json({
      commentary: result.commentary,
      window_slot: windowSlot,
      next_refresh_ms: COMMENTARY_TTL_MS - (now % COMMENTARY_TTL_MS),
    });
  } catch (error) {
    console.error("[market/spx/commentary]", error);
    const message = error instanceof Error ? error.message : String(error);
    // Commentary generation failure (null Haiku result / transient upstream) is
    // retryable — return 502 so the client retries immediately and the next request
    // rebuilds the cache (nothing was stored). Other errors stay 500.
    if (message.startsWith("spx-commentary:")) {
      return NextResponse.json({ error: "Commentary generation failed" }, { status: 502 });
    }
    return NextResponse.json({ error: "Commentary failed" }, { status: 500 });
  }
}
