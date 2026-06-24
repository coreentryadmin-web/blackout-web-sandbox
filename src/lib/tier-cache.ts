import { clerkClient } from "@clerk/nextjs/server";
import { parseTier, type Tier } from "@/lib/tiers";

/**
 * Short-lived per-user tier cache SHARED by both auth gates:
 *   - requireTier()    — the page-render gate (auth-access.ts)
 *   - requireTierApi() — the market-data API gate (market-api-auth.ts)
 *
 * Why shared: market panels poll every 10–60s, and protected pages render on every
 * navigation. Each used to make a fresh clerkClient.users.getUser() call — a storm that
 * hit Clerk's Backend API rate limit (surfacing as intermittent 502s) and added latency
 * to every poll/render. One shared 60s cache collapses that to ~one Clerk call per user
 * per minute AND lets a page render reuse a tier already warmed by a recent panel poll
 * (so a premium user navigating between tools rarely hits a cold getUser at all).
 *
 * Per-replica Map is fine: each Railway replica caches independently and the TTL keeps
 * tier changes (Whop webhook + membership-reconcile cron) visible within a minute.
 */
const tierCache = new Map<string, { tier: Tier; at: number }>();
const TIER_CACHE_TTL_MS = 60_000;

/** Thrown when Clerk is unreachable AND we have no last-known tier to fall back on. */
export class TierUnavailableError extends Error {
  constructor(message = "Tier check temporarily unavailable") {
    super(message);
    this.name = "TierUnavailableError";
  }
}

/**
 * Resolve a user's tier, cache-first.
 * - Fresh cache (< TTL)         → return it (no Clerk call).
 * - Else fetch from Clerk       → cache + return.
 * - Fetch fails, stale present  → return last-known tier (never kick out a paying user).
 * - Fetch fails, NO cache       → throw TierUnavailableError so the CALLER degrades safely
 *                                 (API → retryable 503; page → deny / treat as free).
 *   It NEVER returns a default tier on failure — over-granting premium on a Clerk outage
 *   would be a security hole, so that decision is left to the caller.
 */
export async function resolveUserTier(userId: string): Promise<Tier> {
  const cached = tierCache.get(userId);
  if (cached && Date.now() - cached.at < TIER_CACHE_TTL_MS) {
    return cached.tier;
  }
  try {
    const user = await clerkClient.users.getUser(userId);
    const tier = parseTier(user.publicMetadata?.tier);
    tierCache.set(userId, { tier, at: Date.now() });
    return tier;
  } catch (err) {
    if (cached) {
      console.warn("[tier-cache] Clerk getUser failed; using last-known tier:", err);
      return cached.tier;
    }
    console.warn("[tier-cache] Clerk getUser failed and no cached tier:", err);
    throw new TierUnavailableError();
  }
}
