import { fetchPlayOutcomeStats } from "@/features/spx/lib/spx-play-outcomes";
import { fetchNighthawkOutcomeAnalytics, type NighthawkPlayOutcomeRow } from "@/lib/db";
import { isNighthawkOutcomeScoreable } from "@/lib/track-record-page";

/**
 * Real signal accuracy, read from the LIVE outcome ledgers instead of the
 * `signal_events`/`signal_outcomes` bridge table (`004_god_tier_features.sql`).
 *
 * That bridge table has never received a single write in production — nothing
 * calls `POST /api/signals/record` outside its own route file, so every
 * `JOIN signal_outcomes ON ...` against it always returned zero rows. Both
 * /api/platform/intel (route.ts) and the Night Hawk platform-intel snapshot
 * (platform-intel-snapshot.ts) used to run that dead join independently —
 * this module is the single shared source of truth for both, so they can't
 * silently drift the way the two duplicate implementations did before.
 * See docs/audit/FINDINGS.md for the investigation.
 */

export type SourceAccuracy = {
  total: number;
  wins: number;
  /** 0-100, one decimal. Null when there's no closed sample yet (avoids a bogus 0%). */
  winRate: number | null;
};

export type SignalAccuracyBySource = {
  SPX_SLAYER: SourceAccuracy;
  NIGHT_HAWK: SourceAccuracy;
};

/**
 * Below this many blended closed signals, don't claim a win-rate verdict —
 * a handful of closed plays isn't a big enough sample to size confidently off.
 */
export const MIN_SAMPLE_FOR_RECOMMENDATION = 10;

function pct(wins: number, total: number): number | null {
  return total > 0 ? Math.round((wins / total) * 1000) / 10 : null;
}

/**
 * Pure — exported for unit tests. Mirrors the exact win/loss filter
 * `nhFromRows()` (track-record-page.ts) uses for the public track-record page,
 * so this reports the SAME Night Hawk win rate members see there, not a
 * second, independently-drifting definition of "win."
 */
export function nightHawkAccuracyFromRows(rows: NighthawkPlayOutcomeRow[]): SourceAccuracy {
  const scoreable = rows.filter(isNighthawkOutcomeScoreable);
  const wins = scoreable.filter((r) => r.outcome === "target").length;
  return { total: scoreable.length, wins, winRate: pct(wins, scoreable.length) };
}

/** Fetch + compute real per-source accuracy from spx_play_outcomes + nighthawk_play_outcomes. */
export async function fetchSignalAccuracyBySource(
  nightHawkWindowDays = 30
): Promise<SignalAccuracyBySource> {
  const [stats, nh] = await Promise.all([
    fetchPlayOutcomeStats(),
    fetchNighthawkOutcomeAnalytics(nightHawkWindowDays),
  ]);

  return {
    SPX_SLAYER: {
      total: stats.total_closed,
      wins: stats.overall.wins,
      winRate: pct(stats.overall.wins, stats.total_closed),
    },
    NIGHT_HAWK: nightHawkAccuracyFromRows(nh.rows),
  };
}

/** Blended win rate across both real signal sources — pure, exported for unit tests. */
export function blendedAccuracy(bySource: SignalAccuracyBySource): SourceAccuracy {
  const total = bySource.SPX_SLAYER.total + bySource.NIGHT_HAWK.total;
  const wins = bySource.SPX_SLAYER.wins + bySource.NIGHT_HAWK.wins;
  return { total, wins, winRate: pct(wins, total) };
}
