import { NextRequest, NextResponse } from "next/server";

import { requireTierApi } from "@/lib/market-api-auth";
import { anthropicConfigured } from "@/lib/providers/anthropic";
import { generateSpxCommentary, type SpxCommentaryResult } from "@/lib/providers/spx-commentary";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { serverCache } from "@/lib/server-cache";
import { sharedCacheGet } from "@/lib/shared-cache";

export const dynamic = "force-dynamic";

// All users see the same SPX market data — one Claude call per 3-minute window
// serves every connected session. First request in the window triggers the call;
// all others get the cached result instantly with zero additional cost.
const COMMENTARY_TTL_MS = 3 * 60 * 1000;

type CommentaryCache = {
  commentary: SpxCommentaryResult;
  desk: SpxDeskPayload; // retained so next window can compute delta against it
};

export async function POST(req: NextRequest) {
  const authResult = await requireTierApi("premium");
  if (authResult instanceof Response) return authResult;

  if (!anthropicConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
  }

  let body: { desk?: SpxDeskPayload };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.desk?.available || !body.desk.price) {
    return NextResponse.json({ error: "Desk data required" }, { status: 400 });
  }

  const desk = body.desk;
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

    const result = await serverCache<CommentaryCache | null>(cacheKey, COMMENTARY_TTL_MS, async () => {
      const commentary = await generateSpxCommentary(desk, prevDesk);
      if (!commentary) return null;
      return { commentary, desk };
    });

    if (!result) {
      return NextResponse.json({ error: "Commentary generation failed" }, { status: 502 });
    }

    return NextResponse.json({
      commentary: result.commentary,
      window_slot: windowSlot,
      next_refresh_ms: COMMENTARY_TTL_MS - (now % COMMENTARY_TTL_MS),
    });
  } catch (error) {
    console.error("[market/spx/commentary]", error);
    return NextResponse.json({ error: "Commentary failed" }, { status: 500 });
  }
}
