import { NextRequest, NextResponse } from "next/server";

import { requireTierApi } from "@/lib/market-api-auth";
import { generateSpxCommentary, type SpxCommentaryResult } from "@/features/spx/lib/spx-commentary";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { serverCache } from "@/lib/server-cache";
import { sharedCacheGet } from "@/lib/shared-cache";

export const dynamic = "force-dynamic";

// All users see the same SPX market data — one deterministic read per 5-minute window
// serves every connected session. First request in the window composes it; all others
// get the cached result instantly. (2026-07-13 redesign: the heavy intel prefetch —
// positioning/heatmap/nighthawk/playbook-shadow — is gone with the section dumps it fed;
// the read now composes from the merged desk + live play stores alone via the shared
// spx-live-voice brain. The rail additionally runs the same brain client-side per desk
// tick for the transition event feed; this route remains the shared point-in-time card.)
const COMMENTARY_TTL_MS = 5 * 60 * 1000;

type CommentaryCache = {
  commentary: SpxCommentaryResult;
  desk: SpxDeskPayload; // retained so the next window can diff transitions against it
};

export async function POST(req: NextRequest) {
  const authResult = await requireTierApi("premium");
  if (authResult instanceof Response) return authResult;

  // Body is optional — generation always uses the server-side merged desk.
  void req.json().catch(() => null);

  const now = Date.now();
  const windowSlot = Math.floor(now / COMMENTARY_TTL_MS);
  const cacheKey = `spx-commentary:shared:v2:${windowSlot}`;
  const prevKey = `server:spx-commentary:shared:v2:${windowSlot - 1}`;

  try {
    // Previous window's cached desk (Redis) for transition detection. The pre-redesign
    // cache shape carried extra fields (positioning/heatmapSlice/nighthawk); reading
    // only `.desk` keeps the first post-deploy window compatible with old entries.
    let prevDesk: SpxDeskPayload | null = null;
    try {
      const prev = await sharedCacheGet<CommentaryCache>(prevKey);
      prevDesk = prev?.desk ?? null;
    } catch {
      // Redis unavailable or key expired — no transition feed this window
    }

    const result = await serverCache<CommentaryCache>(cacheKey, COMMENTARY_TTL_MS, async () => {
      const [deskResult, openPlay, lotto, powerHour] = await Promise.all([
        loadMergedSpxDesk(),
        import("@/features/spx/lib/spx-play-store").then((m) => m.loadOpenPlay()).catch(() => null),
        import("@/features/spx/lib/spx-lotto-store").then((m) => m.loadLottoRecord()).catch(() => null),
        import("@/features/spx/lib/spx-power-hour-store").then((m) => m.loadPowerHourRecord()).catch(() => null),
      ]);
      const desk = deskResult.merged;
      if (!desk.available || !(desk.price != null && desk.price > 0)) {
        throw new Error("spx-commentary: desk unavailable");
      }

      const commentary = await generateSpxCommentary(desk, prevDesk, { openPlay, lotto, powerHour });
      // Throw (don't return null) on failure so serverCache skips its store/Redis write —
      // nothing is negatively cached and the next request retries immediately.
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
    // Composition failure (desk unavailable / transient upstream) is retryable — 502 so
    // the client retries and the next request rebuilds the cache. Other errors stay 500.
    if (message.startsWith("spx-commentary:")) {
      return NextResponse.json({ error: "Commentary generation failed" }, { status: 502 });
    }
    return NextResponse.json({ error: "Commentary failed" }, { status: 500 });
  }
}
