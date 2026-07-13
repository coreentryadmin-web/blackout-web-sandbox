/**
 * DARK-POOL LEVELS READER (task #59/#60 synthesis evidence leg).
 *
 * A clean, TICKER-AGNOSTIC, fail-open reader that turns Unusual Whales dark-pool prints into the
 * significant institutional PRICE LEVELS a synthesis verdict cares about — where big off-exchange
 * size printed, how it splits, and whether each level sits as support or resistance vs the current
 * spot. Returns an envelope { levels, asOf, unavailable? } like the other #60 readers.
 *
 * WHY a NEW reader (not the existing dark-pool code): the two existing paths aren't reusable for BIE:
 *   - fetchUwDarkPool(ticker) (unusual-whales.ts) is a BARE prints snapshot — no aggregated levels.
 *   - darkPoolLevelsFromSnapshot (features/vector/lib/vector-dark-pool-levels.ts) is VECTOR-UI-COUPLED:
 *     it emits { strike, premium, pct } in SPX CHART coordinates (default `spx-from-spy` ×10 scaling),
 *     caps at 6, and has no ticker-agnostic price, no support/resistance zone, no asOf/unavailable
 *     envelope, and no fail-open — it takes a snapshot, it doesn't fetch. Same reasoning as the
 *     Benzinga envelope variant: this is a cleanly-typed reader for synthesis, not a duplicate.
 *
 * Governance: reuses the GOVERNED fetchUwDarkPool (uwGetSafe → UW rate-limit + Redis cache), so the
 * limiter/cache stay in-path; this module only aggregates (pure) + wraps fail-open. No extra
 * serverCache: the underlying snapshot is already Redis-cached, the aggregation is cheap/pure, and the
 * support/resistance `zone` depends on the LIVE spot the caller passes — caching that would staleness
 * the classification. Read-only, no writes. Does NOT touch bie/composers or ecosystem-context.
 *
 * HONESTY: levels are exactly what printed (bucketed price + summed notional), nothing invented. `zone`
 * is null unless a finite `spot` is supplied (no reference → no support/resistance claim). Any
 * error/miss/unconfigured returns { levels: [], unavailable: <reason> } — never throws.
 */
import { fetchUwDarkPool, type DarkPoolPrint, type DarkPoolSnapshot } from "./unusual-whales";
import { uwConfigured } from "./config";

export type DarkPoolZone = "support" | "resistance" | "at" | null;

export type DarkPoolLevel = {
  /** Bucketed price level the size printed at. */
  price: number;
  /** Summed notional/premium ($) that printed at this level. */
  notional: number;
  /** Share of the ticker's total dark-pool notional (0–100). */
  pct: number;
  /** Dominant trade side at the level (dark-pool side is often undisclosed → "unknown"). */
  side: "buy" | "sell" | "mixed" | "unknown";
  /** Position vs the supplied spot: below = support, above = resistance, ~equal = at. Null with no spot. */
  zone: DarkPoolZone;
};

export type DarkPoolLevelsResult = {
  ticker: string;
  levels: DarkPoolLevel[];
  /** Total dark-pool notional across all prints ($). */
  totalNotional: number;
  /** Snapshot bias (bullish/bearish/mixed/neutral) from the underlying call/put split. */
  bias: string;
  /** Freshest print time (or fetch time when there are no dated prints). */
  asOf: string;
  /** Set ONLY on error/miss/unconfigured (fail-open). Absent on a successful read, even an empty one. */
  unavailable?: string;
};

/** Within this fraction of spot a level is "at" (neither support nor resistance). */
const AT_SPOT_TOL = 0.0015; // 0.15%
const DEFAULT_MAX_LEVELS = 8;

function dominantSide(buy: number, sell: number): DarkPoolLevel["side"] {
  const total = buy + sell;
  if (total <= 0) return "unknown";
  if (buy >= total * 0.65) return "buy";
  if (sell >= total * 0.65) return "sell";
  return "mixed";
}

function zoneFor(price: number, spot: number | null | undefined): DarkPoolZone {
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return null;
  if (Math.abs(price - spot) <= spot * AT_SPOT_TOL) return "at";
  return price < spot ? "support" : "resistance";
}

/**
 * Pure: aggregate dark-pool prints into significant price levels. Groups by the print's (already
 * bucketed) price, sums notional, derives the dominant trade side, ranks by notional, classifies each
 * level as support/resistance vs `spot` (when given), and returns the top `maxLevels`.
 */
export function aggregateDarkPoolLevels(
  prints: DarkPoolPrint[] | null | undefined,
  opts?: { spot?: number | null; maxLevels?: number }
): DarkPoolLevel[] {
  if (!prints?.length) return [];
  const byPrice = new Map<number, { notional: number; buy: number; sell: number }>();
  let total = 0;
  for (const p of prints) {
    // DarkPoolPrint.strike holds the bucketed PRICE the size printed at (fetchUwDarkPool buckets
    // strike/price/ref_price into it) — it is the price level, not an option strike.
    const price = Number(p.strike);
    const notional = Number(p.premium);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(notional) || notional <= 0) continue;
    const slot = byPrice.get(price) ?? { notional: 0, buy: 0, sell: 0 };
    slot.notional += notional;
    const side = String(p.side ?? "").toLowerCase();
    if (side.startsWith("buy") || side.startsWith("bull") || side === "a" || side === "ask") slot.buy += notional;
    else if (side.startsWith("sell") || side.startsWith("bear") || side === "b" || side === "bid") slot.sell += notional;
    byPrice.set(price, slot);
    total += notional;
  }
  if (total <= 0) return [];
  const spot = opts?.spot ?? null;
  return [...byPrice.entries()]
    .map(([price, s]) => ({
      price,
      notional: s.notional,
      pct: Number(((s.notional / total) * 100).toFixed(1)),
      side: dominantSide(s.buy, s.sell),
      zone: zoneFor(price, spot),
    }))
    .sort((a, b) => b.notional - a.notional)
    .slice(0, opts?.maxLevels ?? DEFAULT_MAX_LEVELS);
}

/** Freshest print `executed_at` (ISO-ish), or null when none carry a timestamp. */
function newestPrintTime(prints: DarkPoolPrint[]): string | null {
  let newest: string | null = null;
  for (const p of prints) {
    const t = String(p.executed_at ?? "");
    if (t && (newest == null || t > newest)) newest = t;
  }
  return newest;
}

/**
 * Fetch significant dark-pool price levels for a ticker. Reuses the governed, Redis-cached
 * fetchUwDarkPool; aggregates its prints into ranked levels and classifies support/resistance vs the
 * optional `spot`. Fail-open: unconfigured / no data / error → { levels: [], unavailable: <reason> }.
 * A clean empty snapshot (no prints today) returns levels: [] with NO `unavailable` (honest "no size
 * printed" ≠ an error).
 */
export async function fetchDarkPoolLevels(
  ticker: string,
  opts?: { spot?: number | null; limit?: number; minPremium?: number; maxLevels?: number }
): Promise<DarkPoolLevelsResult> {
  const sym = ticker.trim().toUpperCase();
  const nowIso = new Date().toISOString();
  const empty = (unavailable?: string): DarkPoolLevelsResult => ({
    ticker: sym,
    levels: [],
    totalNotional: 0,
    bias: "neutral",
    asOf: nowIso,
    ...(unavailable ? { unavailable } : {}),
  });

  if (!uwConfigured()) return empty("UW_API_KEY not set");

  let snapshot: DarkPoolSnapshot | null = null;
  try {
    snapshot = await fetchUwDarkPool(sym, { limit: opts?.limit ?? 50, min_premium: opts?.minPremium });
  } catch (err) {
    return empty(`dark-pool levels ${sym} unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!snapshot) return empty(`dark-pool levels ${sym} unavailable: no snapshot`);

  const levels = aggregateDarkPoolLevels(snapshot.prints, { spot: opts?.spot, maxLevels: opts?.maxLevels });
  return {
    ticker: sym,
    levels,
    totalNotional: Number(snapshot.total_premium) || 0,
    bias: snapshot.bias || "neutral",
    asOf: newestPrintTime(snapshot.prints) ?? nowIso,
  };
}
