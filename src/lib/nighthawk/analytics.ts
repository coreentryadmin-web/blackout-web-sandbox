import { fetchNighthawkOutcomeAnalytics, type NighthawkPlayOutcomeRow } from "@/lib/db";
import { entryRangeMid } from "@/lib/nighthawk/entry-range";

export type NighthawkMetrics = {
  window_days: number;
  total_resolved: number;
  pending_count: number;
  win_rate: number;
  /** Close vs entry mid — positive P&L regardless of target/stop tags. */
  profitable_rate: number;
  loss_rate: number;
  open_rate: number;
  ambiguous_rate: number;
  avg_return_pct: number;
  avg_winner_return_pct: number;
  avg_loser_return_pct: number;
  /**
   * Number of resolved plays excluded from win/loss counts because a stop level
   * is defined but intraday high/low data was unavailable (OTC/thin names).
   * Effective sample size for win_rate = total_resolved - stop_data_unavailable_count.
   */
  stop_data_unavailable_count: number;
  by_conviction: Array<{ conviction: string; n: number; win_rate: number; avg_return_pct: number }>;
  by_direction: Array<{ direction: "LONG" | "SHORT"; n: number; win_rate: number; avg_return_pct: number }>;
  by_sector: Array<{ sector: string; n: number; win_rate: number; avg_return_pct: number }>;
  by_score_bucket: Array<{ bucket: string; n: number; win_rate: number }>;
  by_edition: Array<{ edition_for: string; n: number; win_rate: number; avg_return_pct: number }>;
};

const SCORE_BUCKETS = ["40-54", "55-69", "70-84", "85-100"] as const;
const CONVICTION_ORDER = ["A+", "A", "B", "C"];

export function entryMid(row: NighthawkPlayOutcomeRow): number | null {
  const mid = entryRangeMid(row.entry_range_low, row.entry_range_high);
  if (mid != null) return mid;
  if (row.entry_range_low != null && row.entry_range_high != null) return null; // corrupt range, no fallback
  return row.next_day_open;
}

export function realizedReturnPct(row: NighthawkPlayOutcomeRow): number | null {
  const entry = entryMid(row);
  const close = row.next_day_close;
  if (entry == null || close == null || entry === 0) return null;
  const raw =
    row.direction === "LONG" ? (close - entry) / entry : (entry - close) / entry;
  return raw * 100;
}

function avgReturn(rows: NighthawkPlayOutcomeRow[]): number {
  const values = rows.map(realizedReturnPct).filter((v): v is number => v != null);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Stop-hit plays should always produce a non-positive realized return. A positive
// average here signals bad outcome grading (next_day_close ended up above entry
// mid on a "stop" row) — surface the magnitude as a loss rather than a positive
// number that reads as a gain to whoever consumes this (member route, admin
// dashboard). Mirrors the same clamp on track-record-page.ts's avgLoserPct.
export function avgLoserReturn(losers: NighthawkPlayOutcomeRow[]): number {
  return Math.min(0, avgReturn(losers));
}

function winRate(rows: NighthawkPlayOutcomeRow[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((r) => r.outcome === "target").length / rows.length;
}

function profitableRate(rows: NighthawkPlayOutcomeRow[]): number {
  if (rows.length === 0) return 0;
  const withReturn = rows.filter((r) => realizedReturnPct(r) != null);
  if (withReturn.length === 0) return 0;
  return withReturn.filter((r) => (realizedReturnPct(r) ?? 0) > 0).length / withReturn.length;
}

function scoreBucket(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 40 && score <= 54) return "40-54";
  if (score >= 55 && score <= 69) return "55-69";
  if (score >= 70 && score <= 84) return "70-84";
  if (score >= 85 && score <= 100) return "85-100";
  return null;
}

function groupWithReturn(
  rows: NighthawkPlayOutcomeRow[]
): { n: number; win_rate: number; avg_return_pct: number } {
  return {
    n: rows.length,
    win_rate: winRate(rows),
    avg_return_pct: avgReturn(rows),
  };
}

function emptyMetrics(windowDays: number): NighthawkMetrics {
  return {
    window_days: windowDays,
    total_resolved: 0,
    pending_count: 0,
    win_rate: 0,
    profitable_rate: 0,
    loss_rate: 0,
    open_rate: 0,
    ambiguous_rate: 0,
    avg_return_pct: 0,
    avg_winner_return_pct: 0,
    avg_loser_return_pct: 0,
    by_conviction: CONVICTION_ORDER.map((conviction) => ({
      conviction,
      n: 0,
      win_rate: 0,
      avg_return_pct: 0,
    })),
    by_direction: (["LONG", "SHORT"] as const).map((direction) => ({
      direction,
      n: 0,
      win_rate: 0,
      avg_return_pct: 0,
    })),
    by_sector: [],
    by_score_bucket: SCORE_BUCKETS.map((bucket) => ({ bucket, n: 0, win_rate: 0 })),
    by_edition: [],
    stop_data_unavailable_count: 0,
  };
}

/**
 * Returns true for plays where a stop is defined but intraday data is missing.
 * These plays cannot have stop outcomes reliably determined and must be excluded
 * from win/loss tallies to avoid silently inflating the win rate.
 */
function isStopDataUnavailable(r: NighthawkPlayOutcomeRow): boolean {
  return r.stop != null && r.session_high == null && r.session_low == null;
}

export async function getNighthawkMetrics(windowDays = 30): Promise<NighthawkMetrics> {
  const { rows, pending_count } = await fetchNighthawkOutcomeAnalytics(windowDays);

  if (rows.length === 0) {
    return { ...emptyMetrics(windowDays), pending_count };
  }

  const total = rows.length;
  // Exclude plays where a stop is defined but intraday data is unavailable —
  // stop outcomes cannot be reliably determined for these rows, so including
  // them would silently count unevaluable stops as wins/opens and inflate
  // the reported win rate.
  const stopDataUnavailable = rows.filter(isStopDataUnavailable);
  const scoreable = rows.filter((r) => !isStopDataUnavailable(r));

  const winners = scoreable.filter((r) => r.outcome === "target");
  const losers = scoreable.filter((r) => r.outcome === "stop");
  const opens = scoreable.filter((r) => r.outcome === "open");
  const ambiguous = scoreable.filter((r) => r.outcome === "ambiguous");

  const by_conviction = CONVICTION_ORDER.map((conviction) => ({
    conviction,
    ...groupWithReturn(scoreable.filter((r) => r.conviction.toUpperCase() === conviction)),
  }));

  const by_direction = (["LONG", "SHORT"] as const).map((direction) => ({
    direction,
    ...groupWithReturn(scoreable.filter((r) => r.direction === direction)),
  }));

  const sectorMap = new Map<string, NighthawkPlayOutcomeRow[]>();
  for (const row of scoreable) {
    const sector = row.sector?.trim() || "Unknown";
    const bucket = sectorMap.get(sector) ?? [];
    bucket.push(row);
    sectorMap.set(sector, bucket);
  }
  const by_sector = Array.from(sectorMap.entries())
    .map(([sector, group]) => ({ sector, ...groupWithReturn(group) }))
    .filter((g) => g.n > 0)
    .sort((a, b) => b.win_rate - a.win_rate || b.n - a.n);

  const by_score_bucket = SCORE_BUCKETS.map((bucket) => {
    const group = scoreable.filter((r) => scoreBucket(r.score) === bucket);
    return { bucket, n: group.length, win_rate: winRate(group) };
  });

  const editionMap = new Map<string, NighthawkPlayOutcomeRow[]>();
  for (const row of scoreable) {
    const bucket = editionMap.get(row.edition_for) ?? [];
    bucket.push(row);
    editionMap.set(row.edition_for, bucket);
  }
  const by_edition = Array.from(editionMap.entries())
    .map(([edition_for, group]) => ({ edition_for, ...groupWithReturn(group) }))
    .sort((a, b) => a.edition_for.localeCompare(b.edition_for));

  const scoreableTotal = scoreable.length;
  return {
    window_days: windowDays,
    total_resolved: total,
    pending_count,
    stop_data_unavailable_count: stopDataUnavailable.length,
    win_rate: scoreableTotal > 0 ? winners.length / scoreableTotal : 0,
    profitable_rate: profitableRate(scoreable),
    loss_rate: scoreableTotal > 0 ? losers.length / scoreableTotal : 0,
    open_rate: scoreableTotal > 0 ? opens.length / scoreableTotal : 0,
    ambiguous_rate: scoreableTotal > 0 ? ambiguous.length / scoreableTotal : 0,
    avg_return_pct: avgReturn(scoreable),
    avg_winner_return_pct: avgReturn(winners),
    avg_loser_return_pct: avgLoserReturn(losers),
    by_conviction,
    by_direction,
    by_sector,
    by_score_bucket,
    by_edition,
  };
}
