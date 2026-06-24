import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { timingSafeEqual } from "crypto";
import { tierAtLeast, type Tier } from "@/lib/tiers";
import { resolveUserTier, TierUnavailableError } from "@/lib/tier-cache";

export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const authHeader = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  // Constant-time compare — this is the single auth gate for all 9 cron writers, so the
  // `===` early-exit shouldn't leak the secret byte-by-byte via response timing.
  const a = Buffer.from(authHeader);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** API routes — returns 401/403/503 JSON or {userId,tier} if allowed. */
export async function requireTierApi(
  minTier: Tier
): Promise<{ userId: string; tier: Tier } | Response> {
  const { userId } = await auth();
  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Cache-first tier resolution shared with the page gate (resolveUserTier): ~one Clerk
  // call per user per minute, with last-known-tier fallback so a transient Clerk failure
  // doesn't kick out a paying user.
  let tier: Tier;
  try {
    tier = await resolveUserTier(userId);
  } catch (err) {
    // Clerk unreachable AND no cached tier → RETRYABLE 503 (not a hard 401/500) so the
    // client backs off and retries instead of seeing a misleading "Unauthorized".
    if (!(err instanceof TierUnavailableError)) throw err;
    return jsonResponse({ error: "Auth check temporarily unavailable" }, 503);
  }

  if (!tierAtLeast(tier, minTier)) {
    return jsonResponse({ error: "Forbidden — upgrade required" }, 403);
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

/** Premium desk / flow / SSE market data — cron OR signed-in premium user. */
export async function authorizeMarketDeskApi(
  req: NextRequest
): Promise<{ userId: string | null; via: "cron" | "user" } | Response> {
  return authorizeCronOrTierApi(req, "premium");
}
