import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { tierAtLeast, type Tier } from "@/lib/tiers";
import { resolveUserTier, TierUnavailableError } from "@/lib/tier-cache";

export async function requireAuth(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return userId;
}

export async function getUserTier(userId: string): Promise<Tier> {
  if (!userId) {
    // Guarded by requireAuth() upstream, but log so a stale-JWT/null-session window is
    // visible rather than silently producing "free". The Clerk SDK refreshes on its next
    // poll (≤60 s). Treat as "free" (deny) — never over-grant.
    console.warn("[auth-access] getUserTier called with empty userId — treating as free.");
    return "free";
  }
  // Cache-first, shared with the API gate (one Clerk call per user per minute; a page
  // render reuses a tier warmed by recent panel polls instead of a naked getUser).
  try {
    return await resolveUserTier(userId);
  } catch (err) {
    // Clerk Backend unreachable AND no cached tier. Degrade to the lowest tier so we
    // NEVER over-grant premium on a Clerk outage — requireTier routes to /upgrade and it
    // self-heals once Clerk recovers / a panel poll warms the cache.
    if (!(err instanceof TierUnavailableError)) throw err;
    console.warn("[auth-access] tier unavailable; denying (treating as free) to avoid over-grant.");
    return "free";
  }
}

export async function requireTier(minTier: Tier) {
  const userId = await requireAuth();
  const tier = await getUserTier(userId);

  if (!tierAtLeast(tier, minTier)) {
    redirect("/upgrade");
  }

  return { userId, tier };
}
