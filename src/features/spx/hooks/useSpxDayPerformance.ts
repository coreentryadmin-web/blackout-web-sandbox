"use client";

import useSWR from "swr";
import { todayEtYmdClient } from "@/lib/session-cache";
import type { PlayOutcomeRow, PlayOutcomeStats } from "@/features/spx/lib/spx-play-outcomes";

export type SpxDayPerfStats = {
  plays: number;
  wins: number;
  losses: number;
  breakeven: number;
  win_rate: number | null;  // 0–1, excludes breakeven from denominator
  net_pts: number;          // sum of pnl_pts for closed plays
  avg_win_pts: number | null;
  avg_loss_pts: number | null;
};

type OutcomesResponse = {
  stats: PlayOutcomeStats | null;
  adaptive: unknown;
  rows: PlayOutcomeRow[];
  error?: string;
};

function computeDayStats(rows: PlayOutcomeRow[]): SpxDayPerfStats {
  // Only closed plays (not "open") for today
  const today = todayEtYmdClient();
  const closed = rows.filter((r) => r.session_date === today && r.outcome !== "open");

  const winRows = closed.filter((r) => r.outcome === "win");
  const lossRows = closed.filter((r) => r.outcome === "loss");
  const breakevenRows = closed.filter((r) => r.outcome === "breakeven");

  const plays = closed.length;
  const net_pts = closed.reduce((s, r) => s + (r.pnl_pts ?? 0), 0);

  const avg_win_pts =
    winRows.length > 0
      ? winRows.reduce((s, r) => s + (r.pnl_pts ?? 0), 0) / winRows.length
      : null;

  const avg_loss_pts =
    lossRows.length > 0
      ? lossRows.reduce((s, r) => s + (r.pnl_pts ?? 0), 0) / lossRows.length
      : null;

  // Win rate = wins / (wins + losses); breakeven excluded from denominator
  const decidedPlays = winRows.length + lossRows.length;

  return {
    plays,
    wins: winRows.length,
    losses: lossRows.length,
    breakeven: breakevenRows.length,
    win_rate: decidedPlays > 0 ? winRows.length / decidedPlays : null,
    net_pts: parseFloat(net_pts.toFixed(2)),
    avg_win_pts: avg_win_pts != null ? parseFloat(avg_win_pts.toFixed(2)) : null,
    avg_loss_pts: avg_loss_pts != null ? parseFloat(avg_loss_pts.toFixed(2)) : null,
  };
}

export function useSpxDayPerformance() {
  const { data, error, isLoading } = useSWR<OutcomesResponse>(
    "/api/market/spx/outcomes",
    (url: string) => fetch(url, { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()),
    { refreshInterval: 30_000, revalidateOnFocus: false }
  );

  return {
    stats: data?.rows ? computeDayStats(data.rows) : null,
    loading: isLoading,
    error: !!error || !!data?.error,
  };
}
