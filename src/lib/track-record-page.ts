import { fetchNighthawkOutcomeAnalytics, type NighthawkPlayOutcomeRow } from "@/lib/db";
import { fetchPlayOutcomeStats, type PlayOutcomeStats } from "@/features/spx/lib/spx-play-outcomes";
import { buildPublicTrackRecord, formatPercent } from "@/lib/track-record-public";
import { entryRangeMid } from "@/features/nighthawk/lib/entry-range";

/** Shape returned by GET /api/track-record — shared with TrackRecordView. */
export type TrackRecordPagePayload = {
  spxSlayer: {
    total: number;
    wins: number;
    losses: number;
    winRatePct: number | null;
  };
  nightHawk: {
    total: number;
    wins: number;
    losses: number;
    winRatePct: number | null;
    avgWinnerPct: number | null;
    avgLoserPct: number | null;
    profitFactor: number | null;
    /**
     * total - wins - losses: plays counted as "scoreable" (isNighthawkOutcomeScoreable)
     * whose outcome was neither 'target' nor 'stop' — 'open' (session closed without
     * ever triggering either level) or 'ambiguous' (both levels hit intraday, order
     * unrecoverable from close-only data). Optional/additive: undefined on any older
     * cached payload just means "not computed," not "zero" — do not assume 0 when absent.
     */
    unresolved?: number;
  };
  methodology: string;
  liveData: boolean;
  available?: boolean;
};

const METHODOLOGY =
  "SPX Slayer results are graded from the closed play ledger (every opened play, no cherry-picking). " +
  "Night Hawk results are resolved target/stop outcomes from published editions. " +
  "Night Hawk returns reflect next-day underlying stock price movement from the published entry range midpoint — " +
  "not option-premium returns. Actual option P&L will differ based on strike selection, expiry, and implied volatility at entry. " +
  "Scratch/breakeven counts appear in the embed and desk panels where applicable.";

const NH_WINDOW_DAYS = 90;

function spxFromStats(stats: PlayOutcomeStats | null): TrackRecordPagePayload["spxSlayer"] {
  if (!stats || stats.total_closed <= 0) {
    return { total: 0, wins: 0, losses: 0, winRatePct: null };
  }
  return {
    total: stats.total_closed,
    wins: stats.overall.wins,
    losses: stats.overall.losses,
    winRatePct: formatPercent(stats.overall.win_rate, 1),
  };
}

function nhStopDataUnavailable(r: NighthawkPlayOutcomeRow): boolean {
  return r.stop != null && r.session_high == null && r.session_low == null;
}

/** Same filter as aggregate Night Hawk stats on the track-record page. */
export function isNighthawkOutcomeScoreable(r: NighthawkPlayOutcomeRow): boolean {
  // 'unfilled' (session never traded back into the entry band) has no fill to
  // win or lose — excluded like stop_data_unavailable so gap-away plays can't
  // book phantom wins/losses from an unfillable entry.
  return r.outcome !== "pending" && r.outcome !== "unfilled" && !nhStopDataUnavailable(r);
}

function nhEntryMid(row: NighthawkPlayOutcomeRow): number | null {
  const mid = entryRangeMid(row.entry_range_low, row.entry_range_high);
  if (mid != null) return mid;
  if (row.entry_range_low != null && row.entry_range_high != null) return null; // corrupt range, no fallback
  return row.next_day_open;
}

function nhReturnPct(row: NighthawkPlayOutcomeRow): number | null {
  const entry = nhEntryMid(row);
  const close = row.next_day_close;
  if (entry == null || close == null || entry === 0) return null;
  const raw = row.direction === "LONG" ? (close - entry) / entry : (entry - close) / entry;
  return raw * 100;
}

export function nhFromRows(rows: NighthawkPlayOutcomeRow[]): TrackRecordPagePayload["nightHawk"] {
  const scoreable = rows.filter(isNighthawkOutcomeScoreable);
  const winners = scoreable.filter((r) => r.outcome === "target");
  const losers = scoreable.filter((r) => r.outcome === "stop");
  const total = scoreable.length;
  const wins = winners.length;
  const losses = losers.length;
  // isNighthawkOutcomeScoreable() admits 'open' (session closed without ever hitting
  // target or stop) and 'ambiguous' (both hit intraday, order unrecoverable) alongside
  // 'target'/'stop' — so total can legitimately exceed wins + losses. Previously that gap
  // was invisible: total and wins/losses were reported side by side with no field
  // explaining the difference, reading as a miscount (confirmed live: a 10/6/3 board with
  // no third bucket). Surface it explicitly rather than leaving admins to do the subtraction.
  const unresolved = total - wins - losses;
  const winRatePct = total > 0 ? formatPercent(wins / total, 1) : null;

  const winnerReturns = winners.map(nhReturnPct).filter((v): v is number => v != null);
  const loserReturns = losers.map(nhReturnPct).filter((v): v is number => v != null);
  const avgWinnerPct =
    winnerReturns.length > 0
      ? Math.round((winnerReturns.reduce((a, b) => a + b, 0) / winnerReturns.length) * 10) / 10
      : null;
  // Clamp to ≤ 0: stop-hit plays should always produce a negative return. A positive
  // average here signals bad outcome grading (next_day_close above entry_mid on a
  // stop row) — we surface the magnitude as a loss rather than showing a positive number
  // in a "bear" red tile that reads as a gain to the user.
  const avgLoserPct =
    loserReturns.length > 0
      ? Math.min(0, Math.round((loserReturns.reduce((a, b) => a + b, 0) / loserReturns.length) * 10) / 10)
      : null;

  const grossWins = winnerReturns.reduce((a, b) => a + b, 0);
  const grossLosses = Math.abs(loserReturns.reduce((a, b) => a + b, 0));
  const profitFactor =
    grossLosses > 0 ? Math.round((grossWins / grossLosses) * 100) / 100 : null;

  return {
    total,
    wins,
    losses,
    winRatePct,
    avgWinnerPct,
    avgLoserPct,
    profitFactor,
    unresolved,
  };
}

/**
 * Build the /track-record page payload from the SAME ledgers as the public embed
 * and SPX desk (spx_play_outcomes + nighthawk_play_outcomes). Never throws.
 */
export async function buildTrackRecordPagePayload(): Promise<TrackRecordPagePayload> {
  try {
    const [stats, nh] = await Promise.all([
      fetchPlayOutcomeStats().catch(() => null),
      fetchNighthawkOutcomeAnalytics(NH_WINDOW_DAYS).catch(() => ({ rows: [], pending_count: 0 })),
    ]);

    return {
      spxSlayer: spxFromStats(stats),
      nightHawk: nhFromRows(nh.rows),
      methodology: METHODOLOGY,
      liveData: true,
    };
  } catch (error) {
    console.error("[track-record-page] build failed", error);
    return {
      spxSlayer: { total: 0, wins: 0, losses: 0, winRatePct: null },
      nightHawk: {
        total: 0,
        wins: 0,
        losses: 0,
        winRatePct: null,
        avgWinnerPct: null,
        avgLoserPct: null,
        profitFactor: null,
      },
      methodology: METHODOLOGY,
      liveData: false,
      available: false,
    };
  }
}

/** Compare page SPX block to the public ledger rollup (for verifiers + tests).
 *  Includes the win-rate field: both sides derive from the same shared
 *  `formatPercent()`, so re-rounding the page's 1-decimal value to the public
 *  side's 0-decimal precision with that same function must always agree —
 *  this is what actually catches a future re-divergence (e.g. one call site
 *  reverting to a hand-written rounding formula) rather than just checking
 *  the two sides happen to look similar. */
export function pageSpxMatchesPublic(
  page: TrackRecordPagePayload,
  pub: Awaited<ReturnType<typeof buildPublicTrackRecord>>
): boolean {
  if (!pub.available) return page.spxSlayer.total === 0;
  const winRateAgrees =
    page.spxSlayer.winRatePct == null
      ? pub.win_rate_pct === 0
      : formatPercent(page.spxSlayer.winRatePct / 100, 0) === pub.win_rate_pct;
  return (
    page.spxSlayer.total === pub.total_closed &&
    page.spxSlayer.wins === pub.wins &&
    page.spxSlayer.losses === pub.losses &&
    winRateAgrees
  );
}
