import { redirect } from "next/navigation";
import { auth as clerkAuth } from "@clerk/nextjs/server";
import { tierAtLeast, type Tier } from "@/lib/tiers";
import { resolveUserTier, TierUnavailableError } from "@/lib/tier-cache";
import { isCognitoAuth } from "@/lib/auth-provider";
import { getSession } from "@/lib/auth-server";

export async function requireAuth(): Promise<string> {
  if (isCognitoAuth()) {
    const { userId } = await getSession();
    if (!userId) redirect("/sign-in");
    return userId;
  }
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");
  return userId;
}

export async function getUserTier(userId: string): Promise<Tier> {
  if (!userId) {
    console.warn("[auth-access] getUserTier called with empty userId — treating as free.");
    return "free";
  }
  try {
    return await resolveUserTier(userId);
  } catch (err) {
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
