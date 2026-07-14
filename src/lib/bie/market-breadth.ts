/**
 * MARKET BREADTH BUNDLE (task #62 — data arsenal aggregator).
 *
 * One governed, cached, market-wide reader that composes the breadth pieces already in polygon.ts
 * (grouped-daily summary + prior-day closes → advance/decline metrics, plus the cleaned gainers/losers
 * movers) into ONE typed object, so a consumer imports a single thing for "breadth is 2:1 negative
 * today" context instead of re-wiring the three-call assembly (the exact pattern spx-desk.ts and
 * nighthawk/market-wide.ts each hand-roll today).
 *
 * WHY here (src/lib/bie/): a READER aggregator, mirroring ticker-fundamentals.ts. It does NOT touch
 * ecosystem-context.ts, composers.ts, or the router (Track A wires this into synthesis + shared
 * context). Composes ONLY existing exported readers — nothing new is fetched.
 *
 * HONESTY: breadth is null when the grouped summary is empty (pre-open / holiday); the derived `tone`
 * is "unknown" whenever the sample is too thin to be meaningful. Nothing is fabricated.
 */
import {
  fetchDailyMarketSummary,
  fetchPriorDayCloses,
  fetchMarketMovers,
  computeMarketBreadthFromSummary,
  type MarketBreadthMetrics,
} from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { serverCache, TTL } from "@/lib/server-cache";

export type BreadthTone =
  | "strongly_positive"
  | "positive"
  | "mixed"
  | "negative"
  | "strongly_negative"
  | "unknown";

export type BreadthMover = { ticker: string; change_pct: number; price: number; volume?: number };

export type MarketBreadthBundle = {
  /** Session date (YYYY-MM-DD ET) the breadth was computed for. */
  as_of: string;
  breadth: MarketBreadthMetrics | null;
  /** Cleaned gainers+losers, sorted by |change|. */
  movers: BreadthMover[];
  /** One-word directional read derived from % advancing. */
  tone: BreadthTone;
  /** Factual one-liner for synthesis context. */
  summary: string;
};

/** Below this advance/decline sample the breadth read is not trustworthy → tone "unknown". */
export const MIN_BREADTH_SAMPLE = 100;

/**
 * Pure: classify overall breadth tone from % advancing. Thresholds are symmetric around 50% and
 * deliberately wide (a market day is rarely a clean 50/50). "unknown" when metrics are absent or the
 * sample is too thin to mean anything.
 */
export function classifyBreadthTone(metrics: MarketBreadthMetrics | null): BreadthTone {
  if (!metrics || metrics.sample_size < MIN_BREADTH_SAMPLE || metrics.pct_advancing == null) {
    return "unknown";
  }
  const pct = metrics.pct_advancing;
  if (pct >= 65) return "strongly_positive";
  if (pct >= 55) return "positive";
  if (pct > 45) return "mixed";
  if (pct > 35) return "negative";
  return "strongly_negative";
}

/** Pure: factual one-liner, e.g. "Market breadth: 38.0% advancing, A/D 0.61, 620 names — negative". */
export function summarizeBreadth(metrics: MarketBreadthMetrics | null, tone: BreadthTone): string {
  if (!metrics || tone === "unknown") return "Market breadth: unavailable (thin/empty sample).";
  const pct = metrics.pct_advancing != null ? `${metrics.pct_advancing.toFixed(1)}% advancing` : "advancing n/a";
  const ad = metrics.advance_decline_ratio != null ? `A/D ${metrics.advance_decline_ratio}` : "A/D n/a";
  return `Market breadth: ${pct}, ${ad}, ${metrics.sample_size} names — ${tone.replace("_", " ")}.`;
}

/** Pure: assemble the bundle from already-fetched parts (unit-testable with no network). */
export function assembleBreadthBundle(
  asOf: string,
  breadth: MarketBreadthMetrics | null,
  movers: BreadthMover[]
): MarketBreadthBundle {
  const tone = classifyBreadthTone(breadth);
  return { as_of: asOf, breadth, movers, tone, summary: summarizeBreadth(breadth, tone) };
}

/**
 * Fetch the market breadth bundle for the current session. Cached market-wide on the 1-minute
 * MARKET_TIDE tier (grouped-daily is a large payload that updates continuously during RTH; 1 min keeps
 * it live at bounded upstream cost). Returns null only when Polygon is unconfigured; otherwise returns
 * the bundle with `breadth: null` + `tone: "unknown"` when the summary is empty (pre-open/holiday).
 *
 * Mirrors the exact three-call assembly spx-desk.ts and nighthawk/market-wide.ts use — close-vs-PRIOR
 * -close advance/decline via the prior-close map (not close-vs-open), so the read matches the desk.
 */
export async function fetchMarketBreadthBundle(): Promise<MarketBreadthBundle | null> {
  if (!polygonConfigured()) return null;
  return serverCache<MarketBreadthBundle>("bie:market-breadth:v1", TTL.MARKET_TIDE, async () => {
    const today = todayEtYmd();
    const [dailyMarket, priorCloses, moversRaw] = await Promise.all([
      fetchDailyMarketSummary(today).catch(() => null),
      fetchPriorDayCloses(today).catch(() => ({} as Record<string, number>)),
      fetchMarketMovers(20).catch(() => [] as BreadthMover[]),
    ]);
    let breadth: MarketBreadthMetrics | null = null;
    // computeMarketBreadthFromSummary is synchronous — guard with try/catch, not .catch().
    try {
      breadth = dailyMarket?.results?.length
        ? computeMarketBreadthFromSummary(dailyMarket.results, priorCloses)
        : null;
    } catch {
      breadth = null;
    }
    return assembleBreadthBundle(today, breadth, moversRaw as BreadthMover[]);
  });
}
