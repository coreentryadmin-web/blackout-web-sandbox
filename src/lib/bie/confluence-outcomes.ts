import { dbQuery, dbConfigured } from "@/lib/db";

// BIE Stage 6 precursor — does the ecosystem interconnection actually predict
// anything? The Night Hawk echo on the 0DTE board (ecosystem-context.ts) shows
// members when a ticker already has a prior Night Hawk take; this measures
// whether that overlap correlates with 0DTE Command's own graded direction_hit
// rate. Pure read-only analytics: never feeds back into live scoring or
// alert-firing, only a measurement surface for the admin panel. The whole
// point is to find out honestly, including "no, it doesn't help" — a null or
// insufficient-sample result is a real answer, not a failure to hide.

export type ConfluenceRow = {
  ticker: string;
  session_date: string;
  zerodte_direction: string;
  direction_hit: boolean | null;
  move_pct: number | null;
  nighthawk_edition_for: string | null;
  nighthawk_direction: string | null;
};

export type RawConfluenceRow = {
  ticker: string;
  session_date: string;
  zerodte_direction: string;
  direction_hit: boolean | null;
  move_pct: string | number | null;
  nighthawk_edition_for: string | null;
  nighthawk_direction: string | null;
};

/** Pure: raw query rows -> typed ConfluenceRow, converting move_pct from
 *  Postgres's NUMERIC-as-string wire format to a real number. Split out from
 *  the query specifically because this exact conversion was once missing —
 *  bucketConfluenceRows sums move_pct, and summing un-converted strings is
 *  silent JS string concatenation, not addition, producing NaN -> null in
 *  every avg_move_pct with no error surfaced anywhere. */
export function mapConfluenceRows(rows: RawConfluenceRow[]): ConfluenceRow[] {
  return rows.map((r) => ({
    ticker: r.ticker,
    session_date: r.session_date,
    zerodte_direction: r.zerodte_direction,
    direction_hit: r.direction_hit,
    move_pct: r.move_pct != null ? Number(r.move_pct) : null,
    nighthawk_edition_for: r.nighthawk_edition_for,
    nighthawk_direction: r.nighthawk_direction,
  }));
}

export type ConfluenceBucket = "agree" | "disagree" | "no_echo";

export type ConfluenceBucketStats = {
  bucket: ConfluenceBucket;
  n: number;
  hit_rate_pct: number | null;
  avg_move_pct: number | null;
  insufficient_sample: boolean;
};

/** Below this sample size a hit rate is noise, not signal — flagged, never hidden. */
const MIN_SAMPLE = 10;

const BUCKETS: ConfluenceBucket[] = ["agree", "disagree", "no_echo"];

/**
 * Pure: bucket + aggregate graded 0DTE rows by whether their direction agreed
 * with the most recent Night Hawk take on the same ticker. Split out from the
 * query so the classification/aggregation logic is unit-testable without a DB.
 *
 * Direction values are normalized case-insensitively before comparing:
 * `zerodte_setup_log.direction` stores "long"/"short", but
 * `nighthawk_play_outcomes.direction` stores "LONG"/"SHORT" (see
 * src/lib/nighthawk/claude-edition.ts) — a literal `===` here would silently
 * put every single row in "disagree" regardless of actual agreement.
 */
export function bucketConfluenceRows(rows: ConfluenceRow[]): ConfluenceBucketStats[] {
  const buckets: Record<ConfluenceBucket, ConfluenceRow[]> = { agree: [], disagree: [], no_echo: [] };
  for (const r of rows) {
    if (!r.nighthawk_direction) {
      buckets.no_echo.push(r);
    } else if (r.nighthawk_direction.toUpperCase() === r.zerodte_direction.toUpperCase()) {
      buckets.agree.push(r);
    } else {
      buckets.disagree.push(r);
    }
  }

  return BUCKETS.map((bucket) => {
    const items = buckets[bucket];
    const graded = items.filter((r) => r.direction_hit != null);
    const hits = graded.filter((r) => r.direction_hit === true).length;
    const moves = items.map((r) => r.move_pct).filter((m): m is number => m != null);
    return {
      bucket,
      n: items.length,
      hit_rate_pct: graded.length ? Math.round((hits / graded.length) * 1000) / 10 : null,
      avg_move_pct: moves.length ? Math.round((moves.reduce((a, b) => a + b, 0) / moves.length) * 100) / 100 : null,
      insufficient_sample: items.length < MIN_SAMPLE,
    };
  });
}

/**
 * Joins graded 0DTE Command history against each ticker's most recent PRIOR
 * Night Hawk take (edition_for strictly before the 0DTE session_date — same-
 * day overlap can't exist, the 0DTE scanner excludes today's live Night Hawk
 * names by construction, see nighthawk_covered in src/lib/zerodte/scan.ts) and
 * buckets by direction agreement. Fails open to null: a query failure must
 * read as "the lookup failed," never as a false "zero confluence found."
 */
export async function computeConfluenceOutcomeStats(windowDays = 60): Promise<ConfluenceBucketStats[] | null> {
  if (!dbConfigured()) return null;

  try {
    const res = await dbQuery<RawConfluenceRow>(
      `SELECT
         z.ticker,
         z.session_date::text AS session_date,
         z.direction AS zerodte_direction,
         z.direction_hit,
         z.move_pct,
         n.edition_for::text AS nighthawk_edition_for,
         n.direction AS nighthawk_direction
       FROM zerodte_setup_log z
       LEFT JOIN LATERAL (
         SELECT direction, edition_for
         FROM nighthawk_play_outcomes nh
         WHERE nh.ticker = z.ticker AND nh.edition_for < z.session_date
         ORDER BY nh.edition_for DESC
         LIMIT 1
       ) n ON true
       WHERE z.graded_at IS NOT NULL
         AND z.session_date >= ((NOW() AT TIME ZONE 'America/New_York')::date - $1::int)`,
      [windowDays]
    );
    return bucketConfluenceRows(mapConfluenceRows(res.rows));
  } catch {
    return null;
  }
}
