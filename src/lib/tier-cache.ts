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
 * For immediate cross-replica invalidation (e.g. on membership.activated webhook), call
 * publishTierChanged(userId) which: (1) evicts locally and (2) fans the message to all
 * peers via Redis pub/sub so their stale cached tiers are dropped instantly too.
 */
const tierCache = new Map<string, { tier: Tier; at: number }>();
const TIER_CACHE_TTL_MS = 60_000;

// Bound the per-replica Map (audit §3.3): it's keyed by userId with a 60s TTL but entries were never
// deleted — only overwritten on refresh — so over months of signups (incl. churned/trial userIds) it
// grew unbounded. Same insertion-order LRU + sweep-on-cap pattern as server-cache.ts:setStoreEntry.
const MAX_TIER_CACHE = 5_000;

/** Redis pub/sub channel for cross-replica tier cache invalidation. */
const TIER_CHANGED_CHANNEL = "blackout:tier:changed";

let tierSubReady = false;

function setTierCache(userId: string, tier: Tier): void {
  tierCache.delete(userId); // re-insert → most-recently-used position
  if (tierCache.size >= MAX_TIER_CACHE) {
    const now = Date.now();
    for (const [k, v] of Array.from(tierCache)) {
      if (now - v.at >= TIER_CACHE_TTL_MS) tierCache.delete(k); // reclaim expired before evicting live keys
    }
    while (tierCache.size >= MAX_TIER_CACHE) {
      const oldest = tierCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      tierCache.delete(oldest);
    }
  }
  tierCache.set(userId, { tier, at: Date.now() });
}

/** Evict a single user from the local in-memory tier cache (no-op if not present). */
export function invalidateTierCache(userId: string): void {
  tierCache.delete(userId);
}

/**
 * Lazy, once-per-process subscriber: a peer's tier-changed event drops our stale entry so
 * the next request re-fetches from Clerk. Mirrors the UW circuit-breaker pub/sub pattern.
 * Dynamic import keeps this module alias-free for unit tests; no-ops with no Redis.
 */
function ensureTierCacheSubscription(): void {
  if (tierSubReady) return;
  tierSubReady = true;
  void import("@/lib/redis-pubsub")
    .then(({ redisSubscribe }) =>
      redisSubscribe(TIER_CHANGED_CHANNEL, (userId) => {
        invalidateTierCache(userId);
      })
    )
    .catch(() => {
      tierSubReady = false; // allow a later retry
    });
}

/**
 * Evict userId locally AND broadcast to all replicas via Redis pub/sub so their stale
 * cached tiers are also dropped. Call this after a confirmed Clerk metadata update
 * (e.g. after syncWhopMembershipForEmail returns updatedUserIds). No-ops with no Redis
 * (local-only eviction is still better than nothing and the 60s TTL is the fallback).
 */
export function publishTierChanged(userId: string): void {
  invalidateTierCache(userId);
  void import("@/lib/redis-pubsub")
    .then(({ redisPublish }) => redisPublish(TIER_CHANGED_CHANNEL, userId))
    .catch(() => { /* best-effort */ });
}

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
  ensureTierCacheSubscription();
  const cached = tierCache.get(userId);
  if (cached && Date.now() - cached.at < TIER_CACHE_TTL_MS) {
    return cached.tier;
  }
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    const tier = parseTier(user.publicMetadata?.tier);
    setTierCache(userId, tier);
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
