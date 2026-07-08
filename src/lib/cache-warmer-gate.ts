import { isEtExtendedWarmHours } from "@/lib/et-market-hours";

/**
 * Whether a cache-warmer cron should run upstream fetches (desk/gex/zerodte/heatmap).
 * Staging sets CACHE_WARM_ALWAYS=1 so EventBridge ticks keep caches hot off cash RTH too.
 */
export function shouldRunCacheWarmer(force: boolean, now = new Date()): boolean {
  if (force) return true;
  if (process.env.CACHE_WARM_ALWAYS?.trim() === "1") return true;
  return isEtExtendedWarmHours(now);
}
