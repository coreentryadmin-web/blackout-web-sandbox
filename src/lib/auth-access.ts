import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { parseTier, tierAtLeast, type Tier } from "@/lib/tiers";

export async function requireAuth(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return userId;
}

export async function getUserTier(userId: string): Promise<Tier> {
  // NOTE (stale-JWT risk): this function reads publicMetadata directly from
  // Clerk's backend, which is always current. However the *session JWT* that
  // Clerk embeds in the browser is only refreshed on the next Clerk SDK poll
  // cycle (default ≤60 s). If the calling context has no active session object
  // (e.g. a background server action), session?.reload() cannot be called here
  // and the in-flight JWT may be up to 60 s stale. The middleware tier-gate
  // re-reads sessionClaims on every request and is not affected by this lag.
  if (!userId) {
    // This path should not be reached because requireAuth() guards callers,
    // but log a warning so stale-JWT conditions are visible in logs rather
    // than silently producing a default "free" tier.
    console.warn(
      "[auth-access] getUserTier called with empty userId — " +
        "session may be null or JWT stale. The Clerk SDK will refresh the " +
        "token on the next poll cycle (≤60 s)."
    );
  }
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
