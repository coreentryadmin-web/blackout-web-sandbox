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
import { withServerCache, serverCache, TTL } from "@/lib/server-cache";
import { todayEt } from "@/lib/et-date";
import { fetchGexHeatmap, type GexHeatmap } from "@/lib/providers/polygon-options-gex";
import type { GexWall } from "@/lib/providers/gamma-desk";
import type { SpxDeskLevel } from "@/lib/providers/spx-desk";
import { fetchRecentFlows } from "@/lib/db";
import { fetchPolygonMtfTechnicals } from "@/lib/providers/polygon-largo";
import { fetchBenzingaEarnings } from "@/lib/providers/polygon";
import { fetchUwDarkPool, fetchUwEarnings, fetchUwEarningsEstimates } from "@/lib/providers/unusual-whales";

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

  // ---------------------------------------------------------------------------
  // OPTIONAL cross-tool enrichment (default undefined). Populated by a separate
  // aggregator — NOT by buildPositionContextMap (the list path leaves them unset,
  // so nothing regresses). The verdict engine fires the dependent signals ONLY
  // when the field is actually present (HONESTY RULE): no data → signal never
  // fires, exactly like the GEX/wall signals when source:"none".
  // ---------------------------------------------------------------------------

  /**
   * Recent significant options flow for this underlying (from HELIX/Postgres).
   * Optional. `lean` summarizes the net directional bias of the prints considered;
   * callPremium/putPremium are $ totals; count is how many prints fed the summary.
   */
  flows?: {
    lean: "bullish" | "bearish" | "mixed" | "neutral";
    callPremium: number; // $ total
    putPremium: number; // $ total
    count: number; // number of prints considered
  } | null;

  /** Daily trend from chart technicals. Optional. */
  trend?: "up" | "down" | "sideways" | null;

  /**
   * Key support/resistance levels near spot (from technicals or desk). Optional.
   * Distinct from gexWalls (dealer-gamma): these are price-structure levels.
   */
  levels?: Array<{ kind: "support" | "resistance"; price: number; source?: string }> | null;

  /** Next catalyst (earnings) for this underlying. Optional. */
  catalysts?: {
    earningsDate?: string | null; // ISO date
    daysToEarnings?: number | null; // calendar days from now (>=0)
    beforeExpiry?: boolean | null; // does it land on/before the position's expiry?
  } | null;

  // ---------------------------------------------------------------------------
  // Night Hawk dossier enrichment signals (optional; populated by the detail view
  // from the staged dossier). Each fires a verdict signal ONLY when present (honesty
  // rule). The list path leaves these undefined → those signals never fire.
  // ---------------------------------------------------------------------------

  /**
   * True when the most recent analyst action for this ticker is a downgrade (i.e.
   * the Benzinga analyst summary contains "downgrade"). A downgrade is directionally
   * bearish — it supports trimming a long or holding a short.
   */
  analystDowngrade?: boolean | null;

  /**
   * True when IV rank is high (≥ 70) — elevated implied volatility that could collapse
   * after a binary event (earnings/FDA), causing IV crush on a long options position.
   */
  highIvCrushRisk?: boolean | null;

  /**
   * Directional bias of dark-pool prints for this ticker ("bullish" | "bearish" | "neutral").
   * The verdict engine compares this to the position's exposure to determine alignment.
   */
  darkPoolBias?: "bullish" | "bearish" | "neutral" | null;

  /**
   * True when recent insider transactions show net selling (sells > buys in the recent window).
   * Insider selling is a soft bearish signal — it supports trimming a long.
   */
  insiderNetSell?: boolean | null;

  /**
   * True when short days-to-cover exceeds the squeeze threshold (≥ 5 days), which means a
   * sharp move up could trigger a short squeeze — supportive of a long call / short put.
   */
  shortSqueezeRisk?: boolean | null;

  /**
   * Current IV rank (0–100) for this ticker, from the dossier. Optional.
   * Used by the iv_elevated_long_risk, iv_low_short_risk, and iv_crush_in_progress signals.
   */
  ivRank?: number | null;

  /**
   * IV rank recorded when the position was entered (if available from the dossier/stored data).
   * When present, used to detect a meaningful drop in IV rank since entry (iv_crush_in_progress).
   * Optional — signal skipped when absent (honesty rule).
   */
  entryIv?: number | null;
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
      // kind is GEOMETRIC (spot-side), matching the GexWall contract the verdict engine assumes — NOT
      // the gamma sign. computeGexRegime picks call_wall/put_wall by max +/- net-gamma with no spot-side
      // constraint, so a call_wall can sit BELOW spot (a support); hardcoding "resistance" here fed
      // verdict.ts false gex_wall_broken / approaching signals for non-SPX tickers.
      kind: callWall > spot ? "resistance" : "support",
      distance_pts: Number((callWall - spot).toFixed(2)),
    });
  }
  const putWall = hm.gex.put_wall;
  if (putWall != null && Number.isFinite(putWall)) {
    walls.push({
      strike: putWall,
      net_gex: hm.gex.strike_totals[String(putWall)] ?? 0,
      kind: putWall > spot ? "resistance" : "support", // geometric (see call_wall note above)
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

/** Cache TTL for per-ticker flows snapshot used on the list poll path (ms). */
const NW_FLOWS_TTL_MS = 30_000; // 30s — cheap Postgres read; stays ahead of the 5s poll cadence

/** Cache TTL for per-ticker MTF technicals on the list poll path (ms). */
const NW_TECH_TTL_MS = 60_000; // 60s — matches the detail-view cache key so they share an entry

/**
 * Summarize recent flow prints for one ticker into the verdict's compact `flows` shape.
 * PURE over already-fetched FlowRow[]. Returns null when no prints exist (signal skipped).
 * Mirrors the logic in position-detail.ts summarizeFlows but produces only the fields the
 * verdict engine needs (lean + callPremium + putPremium + count), without topStrikes/sinceHours.
 */
function summarizeFlowsCompact(
  rows: Awaited<ReturnType<typeof fetchRecentFlows>>
): PositionContext["flows"] {
  if (!rows.length) return null;
  let callPremium = 0;
  let putPremium = 0;
  for (const r of rows) {
    if (r.option_type.toUpperCase().startsWith("C")) callPremium += r.premium;
    else putPremium += r.premium;
  }
  const total = callPremium + putPremium;
  let lean: NonNullable<PositionContext["flows"]>["lean"] = "neutral";
  if (total > 0) {
    if (callPremium >= putPremium * 1.25) lean = "bullish";
    else if (putPremium >= callPremium * 1.25) lean = "bearish";
    else lean = "mixed";
  }
  return { lean, callPremium, putPremium, count: rows.length };
}

/**
 * Map a fetchPolygonMtfTechnicals trend_stack string → the verdict's "up"/"down"/"sideways".
 * Mirrors trendFromStack in position-detail.ts exactly.
 */
function trendFromStack(stack: string): "up" | "down" | "sideways" | null {
  if (stack === "bullish") return "up";
  if (stack === "bearish") return "down";
  if (stack === "mixed") return "sideways";
  return null;
}

/**
 * Cache READER for one ticker's recent flows summary, shared across ALL users.
 *
 * Wraps fetchRecentFlows (Postgres, cheap) in withServerCache keyed by (TICKER, ET-date) so
 * N users holding the same underlying collapse to ONE DB read per 30s window (single-flight
 * + Redis + SWR). Best-effort: any error yields null → flows signal skipped (honesty rule).
 */
async function getNwTickerFlows(
  ticker: string
): Promise<PositionContext["flows"]> {
  const root = ticker.trim().toUpperCase();
  if (!root) return null;
  const cacheKey = `nw:flows:${root}:${todayEt()}`;
  return withServerCache<PositionContext["flows"]>(cacheKey, NW_FLOWS_TTL_MS, async () => {
    const rows = await fetchRecentFlows({ ticker: root, since_hours: 48, order: "premium" });
    return summarizeFlowsCompact(rows);
  }).catch(() => null);
}

/**
 * Cache READER for one ticker's MTF technicals (trend label only), shared across ALL users.
 *
 * Uses the SAME cache key as position-detail.ts ("nw:tech:<sym>:<date>") so the two callers
 * share one entry — a detail-view click pre-warms it for the next list poll, and vice versa.
 * Best-effort: any error yields null → trend signal skipped (honesty rule).
 */
async function getNwTickerTrend(
  ticker: string
): Promise<"up" | "down" | "sideways" | null> {
  const root = ticker.trim().toUpperCase();
  if (!root) return null;
  // Polygon index tickers use "I:" prefix (matches detail-view convention for SPX/VIX).
  const polygonSym = root === "SPX" ? "I:SPX" : root === "VIX" ? "I:VIX" : root;
  const cacheKey = `nw:tech:${polygonSym}:${todayEt()}`;
  return withServerCache<"up" | "down" | "sideways" | null>(
    cacheKey,
    NW_TECH_TTL_MS,
    async () => {
      const mtf = await fetchPolygonMtfTechnicals(polygonSym).catch(() => null);
      if (!mtf) return null;
      return trendFromStack(mtf.trend_stack);
    }
  ).catch(() => null);
}

/** Dark pool cache TTL for the list path — 2min, matches fetchUwDarkPool's own UW cache. */
const NW_DARK_POOL_TTL_MS = 120_000;

/**
 * Cache READER for one ticker's dark pool bias, shared across ALL users.
 *
 * Wraps fetchUwDarkPool in withServerCache keyed by (ticker, ET-date) so N users
 * holding the same underlying collapse to ONE UW fetch per TTL window. Dark pool
 * data already has a 2-min UW-side cache; this adds a thin NW layer so the NW
 * poller (5s) never hammers through to the UW tier.
 * Best-effort: any error → null → signal skipped (honesty rule).
 */
async function getNwTickerDarkPool(
  ticker: string
): Promise<PositionContext["darkPoolBias"]> {
  const root = ticker.trim().toUpperCase();
  if (!root) return null;
  const cacheKey = `nw:dp:${root}:${todayEt()}`;
  return withServerCache<PositionContext["darkPoolBias"]>(
    cacheKey,
    NW_DARK_POOL_TTL_MS,
    async () => {
      const snap = await fetchUwDarkPool(root).catch(() => null);
      if (!snap) return null;
      const b = snap.bias;
      if (b === "bullish" || b === "bearish" || b === "neutral") return b;
      return null;
    }
  ).catch(() => null);
}

/** Earnings cache TTL — 5 min, matches the Largo get_earnings tool so they share one entry. */
const NW_EARNINGS_TTL_MS = TTL.EARNINGS; // 300_000

/**
 * Extract the NEXT future earnings date from a UW earnings payload.
 * Pure — mirrors nextEarningsDateFromPayload in position-detail.ts exactly.
 * Returns null when no structured future date exists (honesty: never fabricated).
 */
function nextEarningsDateFromUwRows(
  rows: Array<Record<string, unknown>>,
  todayYmd: string
): string | null {
  let best: string | null = null;
  for (const row of rows) {
    const raw = String(
      row.report_date ?? row.expected_date ?? row.earnings_date ?? row.announce_date ?? row.date ?? ""
    ).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
    if (raw < todayYmd) continue;
    if (best == null || raw < best) best = raw;
  }
  return best;
}

/** Calendar days from todayYmd to targetYmd, clamped >= 0. Returns null on bad input. */
function calendarDaysTo(todayYmd: string, targetYmd: string): number | null {
  const a = Date.parse(`${todayYmd}T00:00:00Z`);
  const b = Date.parse(`${targetYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Cache READER for one ticker's next earnings date + days-to-earnings.
 *
 * Uses the SAME cache key ("earnings:{sym}") as position-detail.ts and the Largo
 * get_earnings tool, so all three callers share ONE upstream fetch per 5-min window.
 * Only UW earnings rows carry machine-readable dates; Benzinga is fetched anyway
 * because that's what the shared cache key stores (the three callers all need it).
 * Best-effort: any error → null → catalysts section omitted (honesty rule).
 *
 * NOT called for SPX/SPXW — index tickers have no earnings.
 */
async function getNwTickerEarnings(
  ticker: string
): Promise<{ earningsDate: string | null; daysToEarnings: number | null }> {
  const root = ticker.trim().toUpperCase();
  if (!root) return { earningsDate: null, daysToEarnings: null };
  return serverCache<{ earningsDate: string | null; daysToEarnings: number | null }>(
    `nw:earnings:${root}:${todayEt()}`,
    NW_EARNINGS_TTL_MS,
    async () => {
      // Mirror getCachedEarnings in position-detail.ts: Benzinga primary + UW supplemental.
      // The raw earnings payload is stored under "earnings:{sym}" (shared with Largo/detail).
      const rawPayload = await serverCache<{
        benzinga_news: unknown;
        unusual_whales: unknown;
        estimates: unknown;
      }>(`earnings:${root}`, NW_EARNINGS_TTL_MS, async () => {
        const benzinga = await fetchBenzingaEarnings(root, 15).catch(() => null);
        const [uw, estimates] = await Promise.all([
          fetchUwEarnings(root).catch(() => null),
          fetchUwEarningsEstimates(root).catch(() => null),
        ]);
        return { benzinga_news: benzinga, unusual_whales: uw, estimates };
      });
      const rows = Array.isArray(rawPayload?.unusual_whales)
        ? (rawPayload.unusual_whales as Array<Record<string, unknown>>)
        : [];
      const today = todayEt();
      const earningsDate = nextEarningsDateFromUwRows(rows, today);
      const daysToEarnings = earningsDate != null ? calendarDaysTo(today, earningsDate) : null;
      return { earningsDate, daysToEarnings };
    }
  ).catch(() => ({ earningsDate: null, daysToEarnings: null }));
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

  // Fetch flows + trend for ALL distinct underlyings in parallel alongside the desk/GEX reads.
  // Both are cache READERS (shared, single-flight, keyed only by ticker+date — never per-user).
  // Best-effort: any failure yields null → the flow/trend signal is simply skipped (honesty rule).
  const [spxContext, gexEntries, flowsEntries, trendEntries, darkPoolEntries, earningsEntries] = await Promise.all([
    spxDeskPromise,
    Promise.all(
      nonSpxUnderlyings.map(async (u) => {
        // getNwTickerGex is best-effort (catches internally) → null on any failure.
        const hm = await getNwTickerGex(u);
        return [u, contextFromHeatmap(hm)] as const;
      })
    ),
    // Flows for every underlying (SPX included — HELIX captures SPX index flows).
    Promise.all(
      underlyings.map(async (u) => [u, await getNwTickerFlows(u)] as const)
    ),
    // MTF trend for every underlying (SPX → "I:SPX" remapped inside getNwTickerTrend).
    Promise.all(
      underlyings.map(async (u) => [u, await getNwTickerTrend(u)] as const)
    ),
    // Dark pool bias for every underlying — shared UW-cached read (2-min TTL).
    // Best-effort: null → signal skipped (honesty rule).
    Promise.all(
      underlyings.map(async (u) => [u, await getNwTickerDarkPool(u)] as const)
    ),
    // Earnings: next date + days-to-earnings for non-SPX underlyings only (SPX has no earnings).
    // Shares the "earnings:{sym}" cache entry with the detail view + Largo tool — free if pre-warmed.
    // Best-effort: { earningsDate: null, daysToEarnings: null } on any failure → catalysts omitted.
    Promise.all(
      nonSpxUnderlyings.map(async (u) => [u, await getNwTickerEarnings(u)] as const)
    ),
  ]);

  // Index flows/trend/dark-pool/earnings by ticker for O(1) lookup when assembling final contexts.
  const flowsByTicker = new Map(flowsEntries);
  const trendByTicker = new Map(trendEntries);
  const darkPoolByTicker = new Map(darkPoolEntries);
  const earningsByTicker = new Map(earningsEntries);

  for (const u of spxUnderlyings) {
    map.set(u, {
      ...spxContext,
      flows: flowsByTicker.get(u) ?? undefined,
      trend: trendByTicker.get(u) ?? undefined,
      darkPoolBias: darkPoolByTicker.get(u) ?? undefined,
      // SPX has no earnings; catalysts intentionally omitted.
    });
  }
  for (const [u, ctx] of gexEntries) {
    const earn = earningsByTicker.get(u);
    const catalysts: PositionContext["catalysts"] =
      earn?.earningsDate != null
        ? { earningsDate: earn.earningsDate, daysToEarnings: earn.daysToEarnings }
        : null;
    map.set(u, {
      ...ctx,
      flows: flowsByTicker.get(u) ?? undefined,
      trend: trendByTicker.get(u) ?? undefined,
      darkPoolBias: darkPoolByTicker.get(u) ?? undefined,
      // beforeExpiry is position-level (depends on each position's expiry); computeVerdict
      // derives it from earningsDate vs position.expiry rather than reading it from here.
      catalysts,
    });
  }
  return map;
}
