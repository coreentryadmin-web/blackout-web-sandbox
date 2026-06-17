import type { NextRequest } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { parseTier, tierAtLeast, type Tier } from "@/lib/tiers";

export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const authHeader = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const q = req.nextUrl.searchParams.get("secret");
  return authHeader === secret || q === secret;
}

/** API routes — returns 401/403 JSON or null if allowed. */
export async function requireTierApi(
  minTier: Tier
): Promise<{ userId: string; tier: Tier } | Response> {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await (await clerkClient()).users.getUser(userId);
  const tier = parseTier(user.publicMetadata?.tier);

  if (!tierAtLeast(tier, minTier)) {
    return new Response(JSON.stringify({ error: "Forbidden — upgrade required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { userId, tier };
}

/** Cron secret OR premium Clerk session — for stateful market engines. */
export async function authorizeCronOrTierApi(
  req: NextRequest,
  minTier: Tier = "premium"
): Promise<{ userId: string | null; via: "cron" | "user" } | Response> {
  if (isCronAuthorized(req)) {
    return { userId: null, via: "cron" };
  }
  const result = await requireTierApi(minTier);
  if (result instanceof Response) return result;
  return { userId: result.userId, via: "user" };
}
