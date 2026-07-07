import { dbQuery, dbConfigured } from "@/lib/db";
import { INDEX_SET, LEVERAGED_ETP_SET } from "@/features/nighthawk/lib/constants";

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
 *  The real exclusion happens in SQL (see fetchHotTickers) so a heavy
 *  index/leverage day can't silently under-fill the result below `limit` —
 *  this stays exported and applied as a second, redundant pass so the
 *  filtering intent is still unit-testable without a DB and the result stays
 *  correct even if the SQL-side exclusion list ever drifts out of sync. */
export function filterHotTickers(rows: HotTicker[]): HotTicker[] {
  return rows.filter((r) => !INDEX_SET.has(r.ticker) && !LEVERAGED_ETP_SET.has(r.ticker));
}

const HOT_TICKERS_WINDOW_HOURS = 6;
const EXCLUDED_HOT_TICKER_SET = [...INDEX_SET, ...LEVERAGED_ETP_SET];

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
    // Exclude index/ETF/leveraged-ETP names IN THE QUERY, before LIMIT — doing
    // this as a post-fetch JS filter (an earlier version of this function did)
    // meant a heavy index/leverage day could occupy most of even a padded
    // over-fetch window and silently return fewer than `limit` single names
    // with no signal to the caller that anything was truncated.
    const res = await dbQuery<{ ticker: string; print_count: number; total_premium: number }>(
      `SELECT ticker, COUNT(*)::int AS print_count, COALESCE(SUM(total_premium), 0)::numeric AS total_premium
       FROM flow_alerts
       WHERE ticker IS NOT NULL AND ticker <> ''
         AND NOT (ticker = ANY($1::text[]))
         AND created_at >= NOW() - ($2 || ' hours')::interval
       GROUP BY ticker
       ORDER BY total_premium DESC
       LIMIT $3`,
      [EXCLUDED_HOT_TICKER_SET, windowHours, cappedLimit]
    );
    const rows: HotTicker[] = res.rows.map((r) => ({
      ticker: r.ticker,
      print_count: Number(r.print_count),
      total_premium: Number(r.total_premium),
    }));
    return filterHotTickers(rows);
  } catch {
    return [];
  }
}
