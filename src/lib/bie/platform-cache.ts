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

/**
 * Intents whose composers read the member's QUESTION itself (not just intent+ticker) to build the
 * answer. For these the cache key MUST carry a question hash: without it every distinct question
 * within a TTL window shares one key and is served whatever answer happened to be cached first.
 * That was the live concept-coverage defect (PR-L1): every `concept_read` shared
 * `bie:largo:concept_read:na:na`, so "what is max pain?" (and 12 other definitional questions)
 * returned the cached "what is GEX?" answer, and "what is Thermal" returned the cached dark-pool
 * definition — the glossary matcher was resolving every term correctly, but the wrong cached
 * envelope was served. The same collision applied to every other question-shaped leg listed here
 * (e.g. "why did we SKIP X" vs "why did we COMMIT X" on cortex_read; two different /api paths on
 * universal_lookup; a 0DTE vs monthly phrasing on vector_read — the horizon lives in the question).
 *
 * Intents NOT listed here (spx_structure, market_context, flow_tape, …) compose the same answer
 * for every phrasing, so keying them question-less is deliberate: it keeps the cache hit-rate high
 * ("same numbers for every member" within the TTL) instead of fragmenting per phrasing.
 */
const QUESTION_KEYED_INTENTS = new Set([
  "spx_desk_read",
  "spx_invalidation",
  "ticker_advice",
  "concept_read",
  "universal_lookup",
  "verdict",
  "system_diagnostic",
  "ops_read",
  "cortex_read",
  "nighthawk_edition",
  "vector_read",
]);

export function largoAnswerCacheKey(
  intent: string,
  ticker: string | null,
  tickerB?: string | null,
  question?: string
): string {
  const q = question?.trim();
  const qSlug =
    q && QUESTION_KEYED_INTENTS.has(intent)
      ? createHash("sha256").update(q.slice(0, 120)).digest("hex").slice(0, 8)
      : "na";
  const b = tickerB ? `:${tickerB}` : "";
  return `bie:largo:${intent}:${ticker ?? "na"}${b}:${qSlug}`;
}
