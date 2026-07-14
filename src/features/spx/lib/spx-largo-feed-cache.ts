/**
 * Shared read seam for Largo's session event feed (2026-07-13, session time bar).
 *
 * SpxCommentaryRail already persists its transition-only event feed to sessionStorage on
 * every update (so reloads keep session context). The session time bar needs the SAME
 * events (as dots on the RTH timeline) without lifting the rail's whole brain-tick state
 * up to the dashboard — so the cache key, the persisted item shape, and a read helper
 * live here, and the rail dispatches LARGO_FEED_UPDATED_EVENT on each write so same-tab
 * consumers refresh immediately (storage events don't fire in the writing tab).
 */

import { readSessionCache } from "@/lib/session-cache";
import type { SpxVoiceEvent, SpxVoiceEventTone } from "@/lib/bie/spx-live-voice";

export const LARGO_FEED_CACHE_KEY = "spx-largo-signal-feed";

/** window CustomEvent name fired by the rail after each persist. */
export const LARGO_FEED_UPDATED_EVENT = "spx-largo-feed-updated";

export const LARGO_FEED_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** One persisted feed line (the rail's FeedItem — shape is the storage contract). */
export type LargoFeedItem = {
  id: string;
  at: number;
  tone: SpxVoiceEventTone;
  line: string;
  kind: SpxVoiceEvent["kind"];
};

/** Read the persisted feed (newest first, as the rail stores it). Empty off-SSR/miss. */
export function readLargoFeed(maxAgeMs = LARGO_FEED_CACHE_MAX_AGE_MS): LargoFeedItem[] {
  const cached = readSessionCache<{ feed?: LargoFeedItem[] }>(LARGO_FEED_CACHE_KEY, maxAgeMs);
  return Array.isArray(cached?.feed) ? cached.feed : [];
}

/** Notify same-tab listeners (the time bar) that the feed cache changed. */
export function announceLargoFeedUpdated(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(LARGO_FEED_UPDATED_EVENT));
  } catch {
    /* CustomEvent unavailable — listeners just fall back to their poll cadence */
  }
}
