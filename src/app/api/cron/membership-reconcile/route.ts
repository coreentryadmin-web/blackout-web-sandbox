import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { reconcileAllMemberships } from "@/lib/membership";
import { logCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Periodic Whop → Clerk entitlement reconcile.
 *
 * The Whop webhook is the only realtime tier-writer and it is fire-and-forget — a dropped
 * or unverified event leaves tiers drifted permanently (paid users locked out on `free`,
 * churned users keeping `premium`). This sweep re-resolves the truth for every active
 * subscriber and every currently-premium user, healing both directions on a schedule.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await reconcileAllMemberships();
    await logCronRun("membership-reconcile", started, { ok: true, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/membership-reconcile]", error);
    await logCronRun("membership-reconcile", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}
