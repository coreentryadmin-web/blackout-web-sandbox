// BlackOut Grid — server-side data plane (cache-reader rule).
//
// The Grid surfaces market-WIDE datasets the platform already pays for. To honor the cache-reader
// rule (one cluster-wide writer serves N viewers at a fixed cost) every Grid dataset that needs an
// upstream pull is fetched ONCE by the `grid-warm` cron and written to Redis under a `grid:*` key.
// The `/api/grid/*` route handlers ONLY read those snapshots — they never fetch upstream per request.
//
// Phase 0/1 datasets live here:
//   • Analyst Actions  — market-wide Benzinga analyst channel (ratings / price targets / up+downgrades
//     / analyst color). Benzinga news has no rate limit, but we still warm ONCE so 500 concurrent
//     viewers share a single upstream pull per window.
//
// Market Pulse reuses the existing SPX desk merged payload (client-side, already cached), Unified News
// reuses /api/market/news, and Notable Flow reuses the HELIX flow stream — none need a new warm here.

import {
  getUwCacheRedis,
  uwCacheGet,
  uwCacheSet,
} from "@/lib/providers/uw-shared-cache";
import { fetchBenzingaNews } from "@/lib/providers/polygon";

// `grid:*` namespace — distinct from the `uw_cache:` keys uwCacheSet/Get prefix with, so Grid
// snapshots never collide with the per-ticker UW cache.
export const GRID_KEYS = {
  analysts: "grid:analysts",
} as const;

// Snapshots are warmed every ~2-5 min during RTH; a generous TTL lets a viewer still read the last
// good snapshot through a brief warm gap (a cache-reader serves stale-but-real over fabricated).
export const GRID_TTL = {
  analysts: 600, // 10 min — analyst actions trickle in; the warm cadence is faster than the TTL
} as const;

/** The exact market-wide Benzinga analyst channel set (space-delimited lowercase, comma-listed).
 *  Mirrors fetchBenzingaAnalystRatings — verified live vs api.massive.com; "analyst-ratings" (hyphen)
 *  returns ZERO results, the working name is "analyst ratings". */
const ANALYST_CHANNELS = "analyst ratings,price target,upgrades,downgrades,analyst color";

export type GridAnalystAction = {
  id: string;
  title: string;
  /** Coarse action derived from the headline/channels — drives the row color (up=emerald/down=bear). */
  action: "upgrade" | "downgrade" | "initiate" | "maintain" | "target" | "other";
  tickers: string[];
  published: string;
  url: string;
};

export type GridAnalystsSnapshot = {
  as_of: string;
  actions: GridAnalystAction[];
};

/** Classify a Benzinga analyst headline into a coarse action for display coloring. */
function classifyAnalystAction(title: string, channels: string[]): GridAnalystAction["action"] {
  const hay = `${title} ${channels.join(" ")}`.toLowerCase();
  if (/\bupgrade|raises? to|raised to\b/.test(hay)) return "upgrade";
  if (/\bdowngrade|cuts? to|lowered? to|lowers? to\b/.test(hay)) return "downgrade";
  if (/\binitiat|initiates? coverage|starts? at|begins? coverage\b/.test(hay)) return "initiate";
  if (/\bmaintains?|reiterat|reaffirm|keeps?\b/.test(hay)) return "maintain";
  if (/\bprice target|pt |raises? pt|cuts? pt|target to\b/.test(hay)) return "target";
  return "other";
}

/** Fetch + shape the market-wide analyst feed. Called by the warmer (and, on a cold cache, by the
 *  reader as a one-time fallback through uwCacheGet's single-flight dedup). */
async function fetchAnalystActions(limit = 30): Promise<GridAnalystsSnapshot> {
  const articles = await fetchBenzingaNews(limit, { channels: ANALYST_CHANNELS });
  const actions: GridAnalystAction[] = articles.map((a) => ({
    id: a.id,
    title: a.title,
    action: classifyAnalystAction(a.title, a.channels),
    tickers: a.tickers.slice(0, 6),
    published: a.published,
    url: a.url,
  }));
  return { as_of: new Date().toISOString(), actions };
}

/** WARMER (grid-warm cron) — fetch ONCE and write the Redis snapshot. Returns the snapshot it wrote
 *  (null only if the upstream pull yielded nothing, so the cron can report an honest failure). */
export async function warmGridAnalysts(): Promise<GridAnalystsSnapshot | null> {
  const snapshot = await fetchAnalystActions(30);
  if (!snapshot.actions.length) return null;
  const redis = await getUwCacheRedis();
  await uwCacheSet(redis, GRID_KEYS.analysts, GRID_TTL.analysts, snapshot);
  return snapshot;
}

/** READER (/api/grid/analysts) — pure cache hit. On a cold cache it falls through to ONE deduped
 *  upstream fetch (uwCacheGet single-flight), then caches it, so the first viewer after a cold boot
 *  doesn't get an empty board. Returns null only when even the fallback fetch yields nothing. */
export async function readGridAnalysts(): Promise<GridAnalystsSnapshot | null> {
  const redis = await getUwCacheRedis();
  const snapshot = await uwCacheGet(
    redis,
    GRID_KEYS.analysts,
    GRID_TTL.analysts,
    () => fetchAnalystActions(30),
  );
  return snapshot.actions.length ? snapshot : null;
}
