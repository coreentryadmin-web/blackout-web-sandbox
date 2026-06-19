import { fetchNighthawkOutcomeAnalytics, type NighthawkPlayOutcomeRow } from "@/lib/db";

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
  by_conviction: Array<{ conviction: string; n: number; win_rate: number; avg_return_pct: number }>;
  by_direction: Array<{ direction: "LONG" | "SHORT"; n: number; win_rate: number; avg_return_pct: number }>;
  by_sector: Array<{ sector: string; n: number; win_rate: number; avg_return_pct: number }>;
  by_score_bucket: Array<{ bucket: string; n: number; win_rate: number }>;
  by_edition: Array<{ edition_for: string; n: number; win_rate: number; avg_return_pct: number }>;
};

const SCORE_BUCKETS = ["40-54", "55-69", "70-84", "85-100"] as const;
const CONVICTION_ORDER = ["A+", "A", "B", "C"];

function entryMid(row: NighthawkPlayOutcomeRow): number | null {
  if (row.entry_range_low != null && row.entry_range_high != null) {
    return (row.entry_range_low + row.entry_range_high) / 2;
  }
  return row.next_day_open;
}

function realizedReturnPct(row: NighthawkPlayOutcomeRow): number | null {
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
  };
}

export async function getNighthawkMetrics(windowDays = 30): Promise<NighthawkMetrics> {
  const { rows, pending_count } = await fetchNighthawkOutcomeAnalytics(windowDays);

  if (rows.length === 0) {
    return { ...emptyMetrics(windowDays), pending_count };
  }

  const total = rows.length;
  const winners = rows.filter((r) => r.outcome === "target");
  const losers = rows.filter((r) => r.outcome === "stop");
  const opens = rows.filter((r) => r.outcome === "open");
  const ambiguous = rows.filter((r) => r.outcome === "ambiguous");

  const by_conviction = CONVICTION_ORDER.map((conviction) => ({
    conviction,
    ...groupWithReturn(rows.filter((r) => r.conviction.toUpperCase() === conviction)),
  }));

  const by_direction = (["LONG", "SHORT"] as const).map((direction) => ({
    direction,
    ...groupWithReturn(rows.filter((r) => r.direction === direction)),
  }));

  const sectorMap = new Map<string, NighthawkPlayOutcomeRow[]>();
  for (const row of rows) {
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
    const group = rows.filter((r) => scoreBucket(r.score) === bucket);
    return { bucket, n: group.length, win_rate: winRate(group) };
  });

  const editionMap = new Map<string, NighthawkPlayOutcomeRow[]>();
  for (const row of rows) {
    const bucket = editionMap.get(row.edition_for) ?? [];
    bucket.push(row);
    editionMap.set(row.edition_for, bucket);
  }
  const by_edition = Array.from(editionMap.entries())
    .map(([edition_for, group]) => ({ edition_for, ...groupWithReturn(group) }))
    .sort((a, b) => a.edition_for.localeCompare(b.edition_for));

  return {
    window_days: windowDays,
    total_resolved: total,
    pending_count,
    win_rate: winners.length / total,
    profitable_rate: profitableRate(rows),
    loss_rate: losers.length / total,
    open_rate: opens.length / total,
    ambiguous_rate: ambiguous.length / total,
    avg_return_pct: avgReturn(rows),
    avg_winner_return_pct: avgReturn(winners),
    avg_loser_return_pct: avgReturn(losers),
    by_conviction,
    by_direction,
    by_sector,
    by_score_bucket,
    by_edition,
  };
}
