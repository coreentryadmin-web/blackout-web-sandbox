import type { NextRequest } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { timingSafeEqual } from "crypto";
import { parseTier, tierAtLeast, type Tier } from "@/lib/tiers";

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

/**
 * Short-lived per-user tier cache. Market panels (commentary, desk, flow, play,
 * lotto) each poll every 10–60s and used to make a fresh clerkClient.users.getUser
 * call on EVERY request — a storm that hit Clerk's Backend API rate limit, throwing
 * and surfacing as intermittent 502s, and added latency to every poll. Caching the
 * resolved tier for 60s collapses that to ~one Clerk call per user per minute.
 * Per-instance Map is fine: each Railway replica caches independently and the TTL
 * keeps tier changes (webhook + membership-reconcile cron) visible within a minute.
 */
const tierCache = new Map<string, { tier: Tier; at: number }>();
const TIER_CACHE_TTL_MS = 60_000;

/** API routes — returns 401/403/503 JSON or {userId,tier} if allowed. */
export async function requireTierApi(
  minTier: Tier
): Promise<{ userId: string; tier: Tier } | Response> {
  const { userId } = await auth();
  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let tier: Tier;
  const cached = tierCache.get(userId);
  if (cached && Date.now() - cached.at < TIER_CACHE_TTL_MS) {
    tier = cached.tier;
  } else {
    try {
      const user = await clerkClient.users.getUser(userId);
      tier = parseTier(user.publicMetadata?.tier);
      tierCache.set(userId, { tier, at: Date.now() });
    } catch (err) {
      // Transient Clerk API failure (rate limit / network). Fall back to the last
      // known tier so a paying user isn't kicked out, else return a RETRYABLE 503
      // (not a hard 401/500) so the client backs off and retries instead of showing
      // a misleading "Unauthorized".
      if (cached) {
        tier = cached.tier;
      } else {
        console.warn("[requireTierApi] Clerk getUser failed, no cached tier:", err);
        return jsonResponse({ error: "Auth check temporarily unavailable" }, 503);
      }
    }
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
