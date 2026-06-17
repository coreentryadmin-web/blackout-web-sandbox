import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { parseTier, tierAtLeast, type Tier } from "@/lib/tiers";

export async function requireAuth(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return userId;
}

export async function getUserTier(userId: string): Promise<Tier> {
  const user = await (await clerkClient()).users.getUser(userId);
  return parseTier(user.publicMetadata?.tier);
}

export async function requireTier(minTier: Tier) {
  const userId = await requireAuth();
  const tier = await getUserTier(userId);

  if (!tierAtLeast(tier, minTier)) {
    redirect("/upgrade");
  }

  return { userId, tier };
}
