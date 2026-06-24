// Night's Watch — per-UNDERLYING context for the deterministic verdict engine.
//
// THE SCALING RULE (same as chain-cache): this is a cache READER, never a
// per-user upstream caller. Cross-tool desk context (GEX walls, dealer regime,
// key levels, max-pain) comes from loadMergedSpxDesk(), which is wrapped in
// withServerCache (60s, shared, single-flight) inside spx-desk-loader.ts. So
// N users holding SPX contracts collapse to ONE desk read per TTL window; the
// marginal cost of another user is ZERO. We resolve the desk ONCE per request
// and hand every SPX position the same snapshot.
//
// HONESTY: context is only attached when real cached data exists. A missing /
// unavailable desk yields no SPX context, and the verdict engine then simply
// skips every GEX-dependent signal rather than inventing one.

import { isSpxTicker } from "@/lib/spx-desk-live";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import type { GexWall } from "@/lib/providers/gamma-desk";
import type { SpxDeskLevel } from "@/lib/providers/spx-desk";

/**
 * Cheap, already-cached cross-tool context for one underlying.
 *
 * For SPX/SPXW this is populated from the shared SPX desk cache. For every other
 * underlying in v1 it is `{ source: "none" }` — the verdict engine falls back to
 * what's already on the position's own valuation (Greeks/IV/underlying) and fires
 * no desk-dependent signals.
 *
 * TODO(nights-watch v2): non-SPX per-ticker GEX/flow context. This must come from
 * a CACHE-WARMED layer (a cron that pre-fetches each distinct open underlying into
 * withServerCache), NEVER an inline per-user upstream call here — otherwise we
 * break the scaling rule. Until that warmer exists, non-SPX stays source:"none".
 */
export type PositionContext = {
  /** Where the desk context came from. "none" → no cross-tool data available. */
  source: "spx-desk" | "none";
  /** Live underlying price from the desk (SPX index), when available. */
  underlyingPrice: number | null;
  /** Dealer gamma regime label, e.g. "mean_revert" / "amplification" / "unknown". */
  gammaRegime: string | null;
  /** Higher-level regime label (trend/chop), when the desk reports one. */
  regime: string | null;
  /** Signed gamma-flip level; price above → mean-revert, below → amplification. */
  gammaFlip: number | null;
  /** Max-pain strike for the index. */
  maxPain: number | null;
  /** Nearby GEX walls (support below / resistance above spot). */
  gexWalls: GexWall[];
  /** Ranked key levels (HOD/PDH/VWAP/EMA/etc.) the desk surfaces. */
  keyLevels: SpxDeskLevel[];
};

const EMPTY_CONTEXT: PositionContext = {
  source: "none",
  underlyingPrice: null,
  gammaRegime: null,
  regime: null,
  gammaFlip: null,
  maxPain: null,
  gexWalls: [],
  keyLevels: [],
};

/** Distinct, normalized underlyings for a batch of positions. */
function distinctUnderlyings(tickers: string[]): string[] {
  return Array.from(new Set(tickers.map((t) => t.trim().toUpperCase())));
}

/**
 * Build a Map<underlying, PositionContext> for a user's positions, resolved ONCE
 * per request. Upstream cost is O(distinct underlyings that need desk context) —
 * and for SPX that's a single shared, cached desk read regardless of how many
 * SPX positions (or users) are in flight.
 *
 * - If ANY position is SPX/SPXW, read the shared SPX desk ONCE and attach the same
 *   snapshot to every SPX underlying key.
 * - Every non-SPX underlying maps to EMPTY_CONTEXT (v1) — see the TODO above.
 *
 * Never throws: a desk failure degrades cleanly to no SPX context (the verdict
 * engine then only uses on-position data), so GET is never blocked by the desk.
 */
export async function buildPositionContextMap(
  tickers: string[]
): Promise<Map<string, PositionContext>> {
  const map = new Map<string, PositionContext>();
  const underlyings = distinctUnderlyings(tickers);
  if (underlyings.length === 0) return map;

  const hasSpx = underlyings.some((u) => isSpxTicker(u));

  // Resolve the shared SPX desk at most ONCE for the whole request.
  let spxContext: PositionContext = EMPTY_CONTEXT;
  if (hasSpx) {
    try {
      const { merged } = await loadMergedSpxDesk();
      if (merged?.available) {
        spxContext = {
          source: "spx-desk",
          underlyingPrice: merged.price > 0 ? merged.price : null,
          gammaRegime: merged.gamma_regime ?? null,
          regime: merged.regime ?? null,
          gammaFlip: merged.gamma_flip ?? null,
          maxPain: merged.max_pain ?? null,
          gexWalls: merged.gex_walls ?? [],
          keyLevels: merged.levels ?? [],
        };
      }
    } catch {
      // Desk unavailable → leave spxContext empty; verdict engine skips GEX signals.
      spxContext = EMPTY_CONTEXT;
    }
  }

  for (const u of underlyings) {
    map.set(u, isSpxTicker(u) ? spxContext : EMPTY_CONTEXT);
  }
  return map;
}
