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
import { withServerCache } from "@/lib/server-cache";
import { todayEt } from "@/lib/et-date";
import { fetchGexHeatmap, type GexHeatmap } from "@/lib/providers/polygon-options-gex";
import type { GexWall } from "@/lib/providers/gamma-desk";
import type { SpxDeskLevel } from "@/lib/providers/spx-desk";

/**
 * Cheap, already-cached cross-tool context for one underlying.
 *
 * For SPX/SPXW this is populated from the shared SPX desk cache (source:"spx-desk",
 * the richest: dealer regime + key levels + max-pain + walls). For every OTHER
 * underlying it is populated from the per-ticker GEX heatmap (source:"gex-heatmap":
 * call/put wall + gamma flip + spot), resolved through a SHARED cache so N users
 * holding the same name collapse to ONE upstream fetch per TTL. When no GEX data
 * exists (illiquid / unknown ticker / fetch error) it is `{ source: "none" }` — the
 * verdict engine then falls back to what's on the position's own valuation
 * (Greeks/IV/underlying) and fires no wall-dependent signals.
 *
 * THE SCALING RULE still holds: the per-ticker GEX read is getNwTickerGex(), which
 * wraps fetchGexHeatmap in withServerCache keyed only by (ticker, ET-date). So it is
 * O(distinct underlyings) with single-flight + Redis + SWR — never per-position,
 * never per-user, and fetchGexHeatmap itself routes through the Polygon limiter.
 */
export type PositionContext = {
  /** Where the desk context came from. "none" → no cross-tool data available. */
  source: "spx-desk" | "gex-heatmap" | "none";
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

/** Per-ticker GEX heatmap cache TTL (ms). Independent of the 20s matrix cache inside
 *  fetchGexHeatmap — this is the Night's Watch read layer, sized for the verdict GET
 *  cadence (walls move slowly enough that ~3 min is plenty fresh for a Hold/Trim call). */
const NW_GEX_TTL_MS = 180_000;

/**
 * Cache READER for one ticker's dealer-gamma profile, shared across ALL users.
 *
 * Wraps fetchGexHeatmap in withServerCache keyed only by (TICKER, ET-date), so 500
 * users holding the same underlying collapse to ONE upstream fetch per TTL window
 * (single-flight + Redis + SWR). fetchGexHeatmap itself already routes through the
 * Polygon rate-limiter and is itself cached (20s) — this layer just makes the Night's
 * Watch read O(distinct tickers) at the verdict cadence. Best-effort: any error or
 * unconfigured provider → null (caller → source:"none", Greeks-only, never fabricated).
 */
export async function getNwTickerGex(ticker: string): Promise<GexHeatmap | null> {
  const root = ticker.trim().toUpperCase();
  if (!root) return null;
  const cacheKey = `nw:gex:${root}:${todayEt()}`;
  return withServerCache<GexHeatmap | null>(cacheKey, NW_GEX_TTL_MS, () =>
    fetchGexHeatmap(root).catch(() => null)
  ).catch(() => null);
}

/**
 * Map a per-ticker GEX heatmap into a PositionContext (source:"gex-heatmap").
 *
 * Walls: the heatmap exposes a single call_wall (largest POSITIVE net dealer gamma →
 * resistance) and a single put_wall (largest NEGATIVE → support). We translate each
 * present wall into the SHARED GexWall shape the verdict engine reads, computing
 * distance_pts from spot. Returns EMPTY_CONTEXT when the heatmap is empty / has no
 * real walls / no spot — so an illiquid name degrades to Greeks-only, never a faked wall.
 */
function contextFromHeatmap(hm: GexHeatmap | null): PositionContext {
  const spot = hm && hm.spot > 0 ? hm.spot : null;
  if (!hm || spot == null) return EMPTY_CONTEXT;

  const walls: GexWall[] = [];
  const callWall = hm.gex.call_wall;
  if (callWall != null && Number.isFinite(callWall)) {
    walls.push({
      strike: callWall,
      net_gex: hm.gex.strike_totals[String(callWall)] ?? 0,
      kind: "resistance",
      distance_pts: Number((callWall - spot).toFixed(2)),
    });
  }
  const putWall = hm.gex.put_wall;
  if (putWall != null && Number.isFinite(putWall)) {
    walls.push({
      strike: putWall,
      net_gex: hm.gex.strike_totals[String(putWall)] ?? 0,
      kind: "support",
      distance_pts: Number((putWall - spot).toFixed(2)),
    });
  }

  // No real walls → no honest wall context; fall back to Greeks-only.
  if (walls.length === 0) return EMPTY_CONTEXT;

  return {
    source: "gex-heatmap",
    underlyingPrice: spot,
    gammaRegime: hm.gex.regime.posture, // "long" | "short" | null
    regime: null, // heatmap has no trend/chop label (desk-only)
    gammaFlip: hm.gex.flip,
    maxPain: hm.max_pain,
    gexWalls: walls,
    keyLevels: [], // heatmap has no ranked HOD/PDH/VWAP levels (desk-only)
  };
}

/**
 * Build a Map<underlying, PositionContext> for a user's positions, resolved ONCE
 * per request. Upstream cost is O(distinct underlyings) regardless of how many
 * positions (or users) are in flight — every read below is a SHARED, single-flight,
 * cached read, never a per-position or per-user upstream call.
 *
 * - If ANY position is SPX/SPXW, read the shared SPX desk ONCE (source:"spx-desk",
 *   richest) and attach the same snapshot to every SPX underlying key.
 * - Every DISTINCT non-SPX underlying resolves its per-ticker GEX heatmap ONCE via
 *   the shared getNwTickerGex cache (source:"gex-heatmap" when real walls exist).
 * - A null/empty/no-wall GEX result → EMPTY_CONTEXT (source:"none") → Greeks-only.
 *
 * The SPX desk read and all per-ticker GEX reads run in PARALLEL. Never throws: any
 * desk or GEX failure degrades cleanly to no context (the verdict engine then only
 * uses on-position data), so GET is never blocked by an upstream.
 */
export async function buildPositionContextMap(
  tickers: string[]
): Promise<Map<string, PositionContext>> {
  const map = new Map<string, PositionContext>();
  const underlyings = distinctUnderlyings(tickers);
  if (underlyings.length === 0) return map;

  const spxUnderlyings = underlyings.filter((u) => isSpxTicker(u));
  const nonSpxUnderlyings = underlyings.filter((u) => !isSpxTicker(u));

  // Resolve the shared SPX desk at most ONCE, and each distinct non-SPX ticker's GEX
  // heatmap ONCE, all in PARALLEL. O(distinct underlyings) shared cached reads.
  const spxDeskPromise: Promise<PositionContext> = spxUnderlyings.length
    ? loadMergedSpxDesk()
        .then(({ merged }) =>
          merged?.available
            ? ({
                source: "spx-desk",
                underlyingPrice: merged.price > 0 ? merged.price : null,
                gammaRegime: merged.gamma_regime ?? null,
                regime: merged.regime ?? null,
                gammaFlip: merged.gamma_flip ?? null,
                maxPain: merged.max_pain ?? null,
                gexWalls: merged.gex_walls ?? [],
                keyLevels: merged.levels ?? [],
              } as PositionContext)
            : EMPTY_CONTEXT
        )
        // Desk unavailable → empty SPX context; verdict engine skips GEX signals.
        .catch(() => EMPTY_CONTEXT)
    : Promise.resolve(EMPTY_CONTEXT);

  const [spxContext, gexEntries] = await Promise.all([
    spxDeskPromise,
    Promise.all(
      nonSpxUnderlyings.map(async (u) => {
        // getNwTickerGex is best-effort (catches internally) → null on any failure.
        const hm = await getNwTickerGex(u);
        return [u, contextFromHeatmap(hm)] as const;
      })
    ),
  ]);

  for (const u of spxUnderlyings) map.set(u, spxContext);
  for (const [u, ctx] of gexEntries) map.set(u, ctx);
  return map;
}
