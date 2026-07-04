import { dbQuery, dbConfigured } from "@/lib/db";
import { INDEX_SET, LEVERAGED_ETP_SET } from "@/lib/nighthawk/constants";

// BIE "what's hot right now" — the leaderboard complement to
// ecosystem-context.ts's per-ticker recent_flow: that answers "how much flow
// has THIS ticker seen," this answers "which tickers are seeing the most flow
// right now." Same source table (flow_alerts), same read-only/fail-open
// contract, different question.
//
// Excludes index/ETF and leveraged-ETP names (the same sets Night Hawk's own
// candidate filter already excludes, src/lib/nighthawk/constants.ts) — SPY/
// QQQ/leveraged products carry enormous baseline volume every single day,
// which would make the leaderboard always show the same 2-3 names instead of
// surfacing genuinely unusual single-name attention.

export type HotTicker = {
  ticker: string;
  print_count: number;
  total_premium: number;
};

/** Pure: drop index/ETF/leveraged-ETP noise from a raw ticker-aggregate list.
 *  Split out from the query so the filtering logic is unit-testable without a DB. */
export function filterHotTickers(rows: HotTicker[]): HotTicker[] {
  return rows.filter((r) => !INDEX_SET.has(r.ticker) && !LEVERAGED_ETP_SET.has(r.ticker));
}

const HOT_TICKERS_WINDOW_HOURS = 6;

/**
 * Top single-name tickers by total options-flow premium over the last
 * `windowHours`. Read-only aggregate over flow_alerts; fails open to an empty
 * array — a lookup failure here must never surface as "no flow anywhere,"
 * just as "couldn't compute this right now."
 */
export async function fetchHotTickers(limit = 8, windowHours = HOT_TICKERS_WINDOW_HOURS): Promise<HotTicker[]> {
  if (!dbConfigured()) return [];
  const cappedLimit = Math.min(Math.max(limit, 1), 25);

  try {
    // Over-fetch before filtering — an index/ETF name occupying a top slot
    // must not shrink the final result below `limit` for single names.
    const res = await dbQuery<{ ticker: string; print_count: number; total_premium: number }>(
      `SELECT ticker, COUNT(*)::int AS print_count, COALESCE(SUM(total_premium), 0)::numeric AS total_premium
       FROM flow_alerts
       WHERE ticker IS NOT NULL AND ticker <> '' AND created_at >= NOW() - ($1 || ' hours')::interval
       GROUP BY ticker
       ORDER BY total_premium DESC
       LIMIT $2`,
      [windowHours, cappedLimit * 3]
    );
    const rows: HotTicker[] = res.rows.map((r) => ({
      ticker: r.ticker,
      print_count: Number(r.print_count),
      total_premium: Number(r.total_premium),
    }));
    return filterHotTickers(rows).slice(0, cappedLimit);
  } catch {
    return [];
  }
}
