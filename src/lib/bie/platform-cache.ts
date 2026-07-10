import "server-only";

import { createHash } from "node:crypto";
import { withServerCache } from "@/lib/server-cache";
import {
  loadBiePlatformContext,
  type BiePlatformContext,
  type LoadBiePlatformContextOpts,
} from "@/lib/bie/platform-context";

/** Desk context — matches SPX matrix RTH poll (8s). SWR serves stale instantly while refreshing. */
export const BIE_DESK_CTX_TTL_MS = 8_000;

/** Market-wide context — 20s; regime/tape move slower than spot. */
export const BIE_MARKET_CTX_TTL_MS = 20_000;

/** Largo deterministic answers — 12s; same question → same numbers for every member. */
export const BIE_LARGO_ANSWER_TTL_MS = 12_000;

function cacheKeyForContext(opts: LoadBiePlatformContextOpts): string {
  const scope = opts.scope ?? "full";
  const kq = opts.knowledgeQuery?.trim();
  const kHash = kq
    ? createHash("sha256").update(kq).digest("hex").slice(0, 10)
    : "none";
  return `bie:ctx:${scope}:${kHash}`;
}

function ttlForScope(scope: LoadBiePlatformContextOpts["scope"]): number {
  if (scope === "desk") return BIE_DESK_CTX_TTL_MS;
  if (scope === "market") return BIE_MARKET_CTX_TTL_MS;
  return 15_000;
}

/**
 * Cached platform context — hot path for Largo + composers.
 * First hit in a TTL window pays one parallel fan-out; everyone else gets memory/Redis SWR (~1ms).
 */
export async function getCachedBiePlatformContext(
  opts: LoadBiePlatformContextOpts = {}
): Promise<BiePlatformContext> {
  const key = cacheKeyForContext(opts);
  const ttl = ttlForScope(opts.scope);
  return withServerCache<BiePlatformContext>(
    key,
    ttl,
    () => loadBiePlatformContext(opts),
    { staleWhileRevalidate: true }
  );
}

export function largoAnswerCacheKey(
  intent: string,
  ticker: string | null,
  tickerB?: string | null,
  question?: string
): string {
  const q = question?.trim();
  const qSlug =
    q && (intent === "spx_desk_read" || intent === "spx_invalidation" || intent === "ticker_advice")
      ? createHash("sha256").update(q.slice(0, 120)).digest("hex").slice(0, 8)
      : "na";
  const b = tickerB ? `:${tickerB}` : "";
  return `bie:largo:${intent}:${ticker ?? "na"}${b}:${qSlug}`;
}
