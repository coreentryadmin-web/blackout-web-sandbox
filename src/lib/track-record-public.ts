import { fetchPlayOutcomeStats } from "@/features/spx/lib/spx-play-outcomes";
import { computeAdaptiveGates } from "@/features/spx/lib/spx-play-telemetry";

/**
 * Sanitized, PUBLIC, PII-free projection of the SPX play track record.
 * P3 social-proof artifact. This is the ONLY shape allowed to leave the server
 * unauthenticated: it contains aggregate counts + win rates ONLY. It MUST NOT
 * include per-trade rows, headlines, entry/exit prices, session dates, ids or
 * any live level that could leak the strategy or constitute PII.
 *
 * Pure-ish helper (single lib import chain, no alias-only tricks) so it can be
 * unit-tested with `tsx --test`.
 */
export type PublicTrackRecord = {
  available: boolean;
  generated_at: string;
  total_closed: number;
  days_of_data: number;
  win_rate_pct: number; // 0-100, integer
  wins: number;
  losses: number;
  breakeven: number;
  paths: {
    cold_buy: { count: number; win_rate_pct: number; avg_mfe_pts: number };
    watch_promote: { count: number; win_rate_pct: number; avg_mfe_pts: number };
  };
  adaptive_active: boolean;
  summary: string;
};

/** Shared canonical formatter for a 0-1 win-rate fraction → a percentage at `dp` decimal
 *  places. The internal /track-record page (dp=1) and this public projection (dp=0) both
 *  route through this so the two displayed numbers are always the same fraction rounded by
 *  the same rule at different precision, never two independently-hand-written formulas that
 *  can double-round-diverge on the same input (e.g. 0.6245 → "62.5%" vs a separately-computed
 *  "62%" instead of the consistent "63%" that rounding 62.5 itself would give). */
export function formatPercent(x: number, dp = 0): number {
  if (!Number.isFinite(x)) return 0;
  const clamped = Math.min(1, Math.max(0, x)) * 100;
  const factor = 10 ** dp;
  return Math.round(clamped * factor) / factor;
}

function pct(x: number): number {
  return formatPercent(x, 0);
}

function pts(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10) / 10;
}

/** Empty/standby payload — used when no data or db unconfigured. Never throws. */
export function emptyTrackRecord(): PublicTrackRecord {
  return {
    available: false,
    generated_at: new Date().toISOString(),
    total_closed: 0,
    days_of_data: 0,
    win_rate_pct: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    paths: {
      cold_buy: { count: 0, win_rate_pct: 0, avg_mfe_pts: 0 },
      watch_promote: { count: 0, win_rate_pct: 0, avg_mfe_pts: 0 },
    },
    adaptive_active: false,
    summary: "Track record warming up.",
  };
}

/**
 * Build the public track record. Reuses the SAME aggregation the premium desk
 * uses (fetchPlayOutcomeStats + computeAdaptiveGates) so the public number can
 * never disagree with the internal one. Read-only; never throws (returns the
 * empty payload on any failure).
 */
export async function buildPublicTrackRecord(): Promise<PublicTrackRecord> {
  try {
    const stats = await fetchPlayOutcomeStats();
    if (!stats || stats.total_closed <= 0) return emptyTrackRecord();
    const adaptive = computeAdaptiveGates(stats);
    return {
      available: true,
      generated_at: new Date().toISOString(),
      total_closed: stats.total_closed,
      days_of_data: Math.round(stats.days_of_data),
      win_rate_pct: pct(stats.overall.win_rate),
      wins: stats.overall.wins,
      losses: stats.overall.losses,
      breakeven: stats.overall.breakeven,
      paths: {
        cold_buy: {
          count: stats.cold_buy.count,
          win_rate_pct: pct(stats.cold_buy.win_rate),
          avg_mfe_pts: pts(stats.cold_buy.avg_mfe),
        },
        watch_promote: {
          count: stats.watch_promote.count,
          win_rate_pct: pct(stats.watch_promote.win_rate),
          avg_mfe_pts: pts(stats.watch_promote.avg_mfe),
        },
      },
      adaptive_active: adaptive.active,
      summary: adaptive.summary || "Adaptive gating standing by.",
    };
  } catch (error) {
    console.error("[track-record-public] build failed", error);
    return emptyTrackRecord();
  }
}
