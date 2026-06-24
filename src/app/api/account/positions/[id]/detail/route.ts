// Night's Watch — FULL DECISION INTEL for one saved position.
// GET → assemble ALL verified, already-cached cross-tool data for the position's
// ticker, recompute the authoritative verdict, and return a plain-English directive
// + the levels to watch. Powers the click→detail modal.
//
// On-demand (detail-view click), never polled. Every source it reads is a cache
// reader — O(distinct ticker) upstream cost, never per-user. Per-user isolation:
// userId comes from Clerk auth(); buildPositionDetail scopes the position load to it,
// so one user can never detail another's position.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { buildPositionDetail } from "@/lib/nights-watch/position-detail";
import { buildPositionNarrative } from "@/lib/nights-watch/position-narrative";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbGuard = requireDatabaseInProduction();
  if (dbGuard) return dbGuard;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const detail = await buildPositionDetail(userId, id);
    if (!detail) return NextResponse.json({ error: "Position not found" }, { status: 404 });
    // Grounded Claude desk narrative — on-demand, cached per-position, globally budgeted.
    // .catch(()=>null) guarantees a narrative failure never breaks the (already-built) detail.
    const narrative = await buildPositionNarrative(detail).catch(() => null);
    return NextResponse.json({ ...detail, narrative }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[account/positions/[id]/detail GET]", error);
    return NextResponse.json({ error: "Failed to build position detail" }, { status: 502 });
  }
}
