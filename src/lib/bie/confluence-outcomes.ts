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

// ── SPX Slayer shadow-factor evidence (additive, parallel to the 0DTE/Night Hawk
// echo pass above) ──
//
// spx_confluence_shadow_observations (src/lib/db.ts, PR #464 + 5 siblings —
// src/lib/spx-signals-shadow*.ts / spx-signals-shadow-{skew,ecosystem,catalysts,
// predictions}.ts) logs what each candidate SPX Slayer factor WOULD have
// contributed to computeSpxConfluence() on every evaluateSpxPlay tick, tagged with
// the REAL confluence score/grade at that same instant. That table's own module doc
// (db.ts, the CREATE TABLE comment) says actual_score/actual_grade exist "for later
// correlation against actual outcomes" — this is that correlation, and it is the
// evidence bie/calibration.ts's MIN_EVIDENCE=10 "prove it before acting on it"
// philosophy (referenced by spx-signals-shadow.ts's own module doc) would require
// before any shadow factor is ever reviewed for promotion into the real scoring
// chain. Nothing here writes back to spx-signals.ts, computeSpxConfluence(), or any
// shadow factor's own scoring function — this module only reads.
//
// SOURCE OF TRUTH: spx_play_outcomes directly, NOT alert_audit_log.outcome a second
// time. db.ts's fetchSpxClaudePlayOutcomeForAudit doc explains why
// alert_audit_log.source_key for spx_claude_play rows has no FK into
// spx_play_outcomes (a verdict is logged BEFORE the engine decides whether to open a
// play, so there's nothing to key on yet) — that function already re-derives the
// join by (direction, price, time window) against spx_play_outcomes, then copies the
// result onto alert_audit_log for a completely different consumer
// (precedent-search.ts's get_similar_precedents corpus). Reading alert_audit_log
// here would mean re-deriving that exact same fuzzy match a SECOND time, one hop
// further from the real ledger, filtered down to only the subset already visited by
// alert-outcome-sync.ts's periodic cron (syncAlertAuditOutcomes) rather than
// everything spx_play_outcomes has ever recorded. spx_play_outcomes is the actual
// system-of-record spx-play-outcomes.ts's classifyOutcome() writes to — joining
// straight to it is more direct, more complete (every closed play, not just synced
// ones), and always current.

export type ShadowFactorDirection = "bullish" | "bearish" | "neutral";

export type ShadowFactorEvidenceRow = {
  factor_name: string;
  factor_direction: ShadowFactorDirection;
  /** spx_play_outcomes.direction — "long" | "short" (spx-play-engine.ts). Kept as a
   *  raw string, not narrowed, since this file has no reason to import that type. */
  play_direction: string;
  /** spx_play_outcomes.outcome, already filtered at the query layer to the three
   *  terminal, gradeable values — "win" | "loss" | "breakeven". */
  play_outcome: string;
  pnl_pts: number | null;
};

export type RawShadowFactorEvidenceRow = {
  factor_name: string;
  factor_direction: string;
  play_direction: string;
  play_outcome: string;
  pnl_pts: string | number | null;
};

/** Pure: raw query rows -> typed ShadowFactorEvidenceRow. Same NUMERIC-as-string
 *  wire-format conversion mapConfluenceRows does above for move_pct — pnl_pts is a
 *  Postgres NUMERIC column and arrives as a string, and bucketShadowFactorEvidence
 *  averages it, so an un-converted string here would hit the exact same silent
 *  string-concatenation-to-NaN-to-null bug move_pct once had. factor_direction is
 *  defensively narrowed rather than cast — an unrecognized value reads as "neutral"
 *  (no directional claim), never crashes and never gets silently miscounted as a
 *  bullish/bearish agreement it never claimed. */
export function mapShadowFactorEvidenceRows(rows: RawShadowFactorEvidenceRow[]): ShadowFactorEvidenceRow[] {
  return rows.map((r) => ({
    factor_name: r.factor_name,
    factor_direction:
      r.factor_direction === "bullish" || r.factor_direction === "bearish" ? r.factor_direction : "neutral",
    play_direction: r.play_direction,
    play_outcome: r.play_outcome,
    pnl_pts: r.pnl_pts != null ? Number(r.pnl_pts) : null,
  }));
}

export type ShadowFactorAgreement = "agree" | "disagree" | "neutral";

const SHADOW_AGREEMENTS: ShadowFactorAgreement[] = ["agree", "disagree", "neutral"];

export type ShadowFactorOutcomeStats = {
  factor_name: string;
  agreement: ShadowFactorAgreement;
  n: number;
  win_rate_pct: number | null;
  avg_pnl_pts: number | null;
  insufficient_sample: boolean;
};

/**
 * Pure: does a shadow factor's directional call agree with the SPX Slayer play it
 * was paired with? Two genuinely different vocabularies, not just a casing quirk
 * like the 0DTE/Night Hawk pair handled in bucketConfluenceRows above —
 * spx_confluence_shadow_observations.direction is "bullish"/"bearish"/"neutral"
 * (every spx-signals-shadow*.ts factor's ShadowFactorObservation type) while
 * spx_play_outcomes.direction is "long"/"short" (spx-play-engine.ts). A "neutral"
 * factor reading makes no directional claim at all, so it can neither agree nor
 * disagree with anything — bucketed on its own, exactly like bucketConfluenceRows'
 * "no_echo" bucket is kept separate from agree/disagree rather than folded into
 * either.
 */
export function classifyShadowFactorAgreement(
  factorDirection: ShadowFactorDirection,
  playDirection: string
): ShadowFactorAgreement {
  if (factorDirection === "neutral") return "neutral";
  const impliedPlayDirection = factorDirection === "bullish" ? "long" : "short";
  return impliedPlayDirection === playDirection ? "agree" : "disagree";
}

/**
 * Pure: bucket + aggregate shadow-factor evidence rows by factor_name x agreement.
 * `factorNames` is the FULL set of factor_name values actually observed
 * (available=true) over the query window, independent of whether any of them ever
 * matched a play — every factor_name gets all 3 agreement buckets in the output,
 * even ones with zero matched plays (n: 0, insufficient_sample: true, every stat
 * null). This is the honest "no evidence yet" case a brand-new shadow factor (or one
 * whose observations never happened to land within 30 minutes of a graded play's
 * entry) must show: never silently omitted (indistinguishable from "checked, found
 * nothing interesting") and never backfilled with a fabricated 0% or 50% win rate.
 */
export function bucketShadowFactorEvidence(
  factorNames: string[],
  rows: ShadowFactorEvidenceRow[]
): ShadowFactorOutcomeStats[] {
  const allFactorNames = new Set(factorNames);
  for (const r of rows) allFactorNames.add(r.factor_name);

  const groups = new Map<string, ShadowFactorEvidenceRow[]>();
  for (const r of rows) {
    const agreement = classifyShadowFactorAgreement(r.factor_direction, r.play_direction);
    const key = `${r.factor_name}|${agreement}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const out: ShadowFactorOutcomeStats[] = [];
  for (const factor_name of [...allFactorNames].sort()) {
    for (const agreement of SHADOW_AGREEMENTS) {
      const items = groups.get(`${factor_name}|${agreement}`) ?? [];
      const wins = items.filter((r) => r.play_outcome === "win").length;
      const pnls = items.map((r) => r.pnl_pts).filter((p): p is number => p != null);
      out.push({
        factor_name,
        agreement,
        n: items.length,
        win_rate_pct: items.length ? Math.round((wins / items.length) * 1000) / 10 : null,
        avg_pnl_pts: pnls.length ? Math.round((pnls.reduce((a, b) => a + b, 0) / pnls.length) * 100) / 100 : null,
        insufficient_sample: items.length < MIN_SAMPLE,
      });
    }
  }
  return out;
}

/**
 * Joins each SPX Slayer closed play (spx_play_outcomes — 'win'/'loss'/'breakeven'
 * only; 'open' and 'superseded' excluded exactly like alert-outcome-sync.ts's
 * mapSpxPlayOutcome treats them, as "leave alone", never a real trade result)
 * against the closest shadow-factor observation FOR EACH factor_name taken within 30
 * minutes of that play's entry (opened_at) — the reading in effect at/near the
 * moment the trade was actually taken. The 30-minute window mirrors two existing
 * precedents in this exact codebase for the identical "still fresh enough to mean
 * something" reasoning: fetchSpxClaudePlayOutcomeForAudit's own opened_at window
 * (db.ts) and spx-signals-shadow.ts's ANOMALY_WINDOW_MS.
 *
 * ONE row per (play, factor_name), never one row per observation tick: shadow
 * factors are logged on every evaluateSpxPlay tick (spx-signal-log.ts), so a single
 * SPX Slayer play that stayed open for an hour could have dozens of observations for
 * the same factor_name, all carrying the SAME eventual outcome. Counting every tick
 * would let one trade masquerade as 10+ pieces of independent evidence on its own —
 * exactly the noise bie/calibration.ts's MIN_EVIDENCE=10 gate exists to guard
 * against. `DISTINCT ON (factor_name)`, ordered by closeness in time to opened_at
 * (by absolute difference, not "most recent before," since shadow logging and the
 * play-open write happen as two independent fire-and-forget calls in the same tick
 * — see evaluateSpxPlay in spx-play-engine.ts — so either can land first at the DB),
 * collapses each play's tick-stream down to the single reading nearest entry: one
 * play, one vote, per factor.
 *
 * Fails open to null, matching computeConfluenceOutcomeStats above: a query failure
 * must read as "the lookup failed," never as a false "zero evidence found."
 */
export async function computeSpxSlayerShadowFactorOutcomeStats(
  windowDays = 60
): Promise<ShadowFactorOutcomeStats[] | null> {
  if (!dbConfigured()) return null;

  try {
    const [factorNamesRes, evidenceRes] = await Promise.all([
      dbQuery<{ factor_name: string }>(
        `SELECT DISTINCT factor_name
         FROM spx_confluence_shadow_observations
         WHERE available = true
           AND observed_at >= NOW() - ($1::int || ' days')::interval`,
        [windowDays]
      ),
      dbQuery<RawShadowFactorEvidenceRow>(
        `SELECT
           p.direction AS play_direction,
           p.outcome AS play_outcome,
           p.pnl_pts,
           f.factor_name,
           f.direction AS factor_direction
         FROM spx_play_outcomes p
         JOIN LATERAL (
           SELECT DISTINCT ON (sfo.factor_name)
             sfo.factor_name, sfo.direction
           FROM spx_confluence_shadow_observations sfo
           WHERE sfo.available = true
             AND sfo.observed_at BETWEEN p.opened_at - interval '30 minutes'
                                     AND p.opened_at + interval '30 minutes'
           ORDER BY sfo.factor_name, ABS(EXTRACT(EPOCH FROM (sfo.observed_at - p.opened_at)))
         ) f ON true
         WHERE p.outcome IN ('win', 'loss', 'breakeven')
           AND p.opened_at >= NOW() - ($1::int || ' days')::interval`,
        [windowDays]
      ),
    ]);

    return bucketShadowFactorEvidence(
      factorNamesRes.rows.map((r) => r.factor_name),
      mapShadowFactorEvidenceRows(evidenceRes.rows)
    );
  } catch {
    return null;
  }
}
