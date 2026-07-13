/**
 * TICKER FUNDAMENTALS BUNDLE (task #62 — Polygon data arsenal aggregator).
 *
 * A single governed, cached, TICKER-FILTERED reader that composes the fundamentals + short-positioning
 * signals the synthesis engine (Track A's #59) needs about one name, so a consumer makes ONE call
 * instead of fanning out to five providers and re-deriving the merge. Every underlying reader already
 * exists in src/lib/providers/polygon.ts (financial ratios, the three statements → derived signals,
 * the Benzinga analyst price target, short-interest/days-to-cover, and the short-volume ratio); this
 * module only orchestrates + caches them behind one typed shape. Nothing new is fetched that a reader
 * didn't already expose.
 *
 * WHY here (src/lib/bie/) not a composer: the coordinator's Track-A/Track-B split — this is a READER
 * aggregator, explicitly allowed as a new src/lib/bie file. It does NOT touch ecosystem-context.ts,
 * composers.ts, or the router (Track A wires this bundle into synthesis + the shared context).
 *
 * HONESTY: every field is null when its source has no data — nothing is fabricated. Each underlying
 * fetch is independently defensive (a single provider outage nulls only its own slice, never the whole
 * bundle). Cached on the 1h REFERENCE tier: fundamentals/short-interest change slowly (statements
 * quarterly, short-interest bi-monthly settlement), so a per-name 1h cache is fresh at near-zero cost.
 */
import { serverCache, TTL } from "@/lib/server-cache";
import {
  fetchPolygonFinancialRatios,
  fetchPolygonIncomeStatements,
  fetchPolygonBalanceSheets,
  fetchPolygonCashFlowStatements,
  computeFundamentalSignals,
  fetchBenzingaPriceTarget,
  fetchShortInterest,
  fetchShortVolume,
  type PolygonFinancialRatios,
  type FundamentalSignals,
  type BenzingaPriceTarget,
} from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";

/** Normalized short-interest slice (source coerces missing numerics to 0; we keep dates as the
 *  freshness anchor). */
export type ShortInterestSlice = {
  settlement_date: string | null;
  short_interest: number | null;
  avg_daily_volume: number | null;
  days_to_cover: number | null;
};

export type TickerFundamentalsBundle = {
  ticker: string;
  /** Freshest observation date across the slices (ratios → signals → short-interest → short-volume). */
  as_of: string | null;
  ratios: PolygonFinancialRatios | null;
  signals: FundamentalSignals | null;
  price_target: BenzingaPriceTarget | null;
  short_interest: ShortInterestSlice | null;
  /** Latest daily short-volume ratio (0–1) for the most recent session, or null. */
  short_volume_ratio: number | null;
  short_volume_date: string | null;
};

type ShortVolumeRow = { date: string; short_volume: number; total_volume: number; short_volume_ratio: number };

/** Pure: pick the most-recent short-volume row's ratio + date (freshest by ISO date, not trusting sort). */
export function summarizeShortVolume(
  rows: ShortVolumeRow[]
): { short_volume_ratio: number | null; short_volume_date: string | null } {
  let best: ShortVolumeRow | null = null;
  for (const r of rows) {
    if (!r?.date) continue;
    if (!best || r.date > best.date) best = r;
  }
  if (!best) return { short_volume_ratio: null, short_volume_date: null };
  const ratio = Number.isFinite(best.short_volume_ratio) && best.short_volume_ratio > 0 ? best.short_volume_ratio : null;
  return { short_volume_ratio: ratio, short_volume_date: best.date || null };
}

/** Normalize the raw fetchShortInterest object (which coerces missing numerics to 0) into a slice
 *  whose fields are null when there is genuinely no reading (empty settlement date ⇒ no data). */
export function normalizeShortInterest(
  si: Awaited<ReturnType<typeof fetchShortInterest>>
): ShortInterestSlice | null {
  if (!si) return null;
  const date = si.settlement_date || null;
  const finiteOrNull = (n: number) => (Number.isFinite(n) && n !== 0 ? n : null);
  const slice: ShortInterestSlice = {
    settlement_date: date,
    short_interest: finiteOrNull(si.short_interest),
    avg_daily_volume: finiteOrNull(si.avg_daily_volume),
    days_to_cover: finiteOrNull(si.days_to_cover),
  };
  // Nothing usable at all → null (no date and no numbers).
  if (slice.settlement_date == null && slice.short_interest == null && slice.days_to_cover == null) {
    return null;
  }
  return slice;
}

/** Pure: assemble the bundle from already-fetched parts (unit-testable with no network). */
export function assembleFundamentalsBundle(
  ticker: string,
  parts: {
    ratios: PolygonFinancialRatios | null;
    signals: FundamentalSignals | null;
    priceTarget: BenzingaPriceTarget | null;
    shortInterest: ShortInterestSlice | null;
    shortVolume: { short_volume_ratio: number | null; short_volume_date: string | null };
  }
): TickerFundamentalsBundle {
  const as_of =
    parts.ratios?.as_of ??
    parts.signals?.latest_period_end ??
    parts.shortInterest?.settlement_date ??
    parts.shortVolume.short_volume_date ??
    null;
  return {
    ticker: ticker.toUpperCase(),
    as_of,
    ratios: parts.ratios,
    signals: parts.signals,
    price_target: parts.priceTarget,
    short_interest: parts.shortInterest,
    short_volume_ratio: parts.shortVolume.short_volume_ratio,
    short_volume_date: parts.shortVolume.short_volume_date,
  };
}

/**
 * Fetch the composed fundamentals + short-positioning bundle for one ticker. Cached per-name on the
 * 1h REFERENCE tier. Returns null only when Polygon is unconfigured; otherwise returns the bundle with
 * whatever slices were available (each null on its own source's miss) — a partial read is honest and
 * still useful to synthesis.
 */
export async function fetchTickerFundamentalsBundle(
  ticker: string
): Promise<TickerFundamentalsBundle | null> {
  if (!polygonConfigured()) return null;
  const sym = ticker.toUpperCase();
  return serverCache<TickerFundamentalsBundle>(`bie:ticker-fundamentals:v1:${sym}`, TTL.REFERENCE, async () => {
    const [ratios, income, balance, cashFlow, priceTarget, shortInterestRaw, shortVolumeRows] =
      await Promise.all([
        fetchPolygonFinancialRatios(sym).catch(() => null),
        fetchPolygonIncomeStatements(sym, 6).catch(() => []),
        fetchPolygonBalanceSheets(sym, 6).catch(() => []),
        fetchPolygonCashFlowStatements(sym, 6).catch(() => []),
        fetchBenzingaPriceTarget(sym).catch(() => null),
        fetchShortInterest(sym).catch(() => null),
        fetchShortVolume(sym, 5).catch(() => []),
      ]);
    const signals = computeFundamentalSignals(income, balance, cashFlow);
    return assembleFundamentalsBundle(sym, {
      ratios,
      signals,
      priceTarget,
      shortInterest: normalizeShortInterest(shortInterestRaw),
      shortVolume: summarizeShortVolume(shortVolumeRows),
    });
  });
}
