import { dbConfigured } from "@/lib/db";
import { outcomeAdaptiveMinDays, outcomeAdaptiveMinTrades } from "@/features/spx/lib/spx-play-config";
import { fetchPlayOutcomeStats, fetchRecentPlayOutcomes } from "@/features/spx/lib/spx-play-outcomes";
import { computeAdaptiveGates } from "@/features/spx/lib/spx-play-telemetry";
import type { PlayOutcomeStats } from "@/features/spx/lib/spx-play-outcomes";

export type GradeBreakdown = {
  grade: string;
  count: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_pnl: number;
};

export type ExitBreakdown = {
  exit_action: string;
  count: number;
  avg_pnl: number;
};

export type DailyRollup = {
  day: string;
  trades: number;
  wins: number;
  losses: number;
  avg_pnl: number;
  total_pnl: number;
};

export type SignalActionCount = {
  action: string;
  count: number;
};

export type SpxAdminAnalytics = {
  db_configured: boolean;
  outcome_stats: PlayOutcomeStats;
  adaptive: ReturnType<typeof computeAdaptiveGates>;
  grade_breakdown: GradeBreakdown[];
  exit_breakdown: ExitBreakdown[];
  daily_rollup: DailyRollup[];
  signal_actions_30d: SignalActionCount[];
  signals_today: number;
  flow_alerts_today: number;
  open_outcomes: number;
  avg_pnl_pts: number;
  avg_mfe_pts: number;
  avg_mae_pts: number;
  insights: string[];
  recent_outcomes: Awaited<ReturnType<typeof fetchRecentPlayOutcomes>>;
  recent_signals: Awaited<ReturnType<typeof import("@/lib/db").fetchRecentSpxSignalLogs>>;
};

function insightsFromAnalytics(
  stats: PlayOutcomeStats,
  adaptive: ReturnType<typeof computeAdaptiveGates>,
  gradeBreakdown: GradeBreakdown[]
): string[] {
  const lines: string[] = [];

  if (stats.total_closed === 0) {
    lines.push("No closed SPX plays logged yet — outcomes populate when BUY trades close.");
    return lines;
  }

  if (!adaptive.active) {
    lines.push(
      `Adaptive gates collecting data (${stats.total_closed}/${outcomeAdaptiveMinTrades()} trades, ${stats.days_of_data.toFixed(0)}/${outcomeAdaptiveMinDays()} days).`
    );
  } else {
    lines.push(adaptive.summary);
  }

  lines.push(
    `Overall win rate ${(stats.overall.win_rate * 100).toFixed(0)}% across ${stats.total_closed} closed plays.`
  );

  if (stats.cold_buy.count >= 2 && stats.watch_promote.count >= 2) {
    const gap = stats.cold_buy.win_rate - stats.watch_promote.win_rate;
    if (gap >= 0.15) {
      lines.push(
        `WATCH→ENTRY trails cold BUY by ${(gap * 100).toFixed(0)} pts — promote path is penalized in telemetry.`
      );
    } else if (gap <= -0.1) {
      lines.push(`WATCH→ENTRY outperforming cold BUY — promote discipline is working.`);
    }
  }

  const aGrades = gradeBreakdown.filter((g) => g.grade.startsWith("A"));
  if (aGrades.length) {
    const best = aGrades.sort((a, b) => b.win_rate - a.win_rate)[0];
    if (best.count >= 2) {
      lines.push(`Grade ${best.grade}: ${(best.win_rate * 100).toFixed(0)}% win rate (${best.count} trades).`);
    }
  }

  if (stats.overall.win_rate < 0.45 && stats.total_closed >= 8) {
    lines.push("Win rate below 45% — engine may be too aggressive; review gate thresholds.");
  }

  return lines;
}

export async function fetchSpxAdminAnalytics(): Promise<SpxAdminAnalytics> {
  const configured = dbConfigured();
  const outcome_stats = await fetchPlayOutcomeStats();
  const adaptive = computeAdaptiveGates(outcome_stats);
  const recent_outcomes = await fetchRecentPlayOutcomes(40);

  let grade_breakdown: GradeBreakdown[] = [];
  let exit_breakdown: ExitBreakdown[] = [];
  let daily_rollup: DailyRollup[] = [];
  let signal_actions_30d: SignalActionCount[] = [];
  let signals_today = 0;
  let flow_alerts_today = 0;
  let open_outcomes = 0;
  let avg_pnl_pts = 0;
  let avg_mfe_pts = 0;
  let avg_mae_pts = 0;
  let recent_signals: SpxAdminAnalytics["recent_signals"] = [];

  if (configured) {
    const { fetchSpxAdminRollups } = await import("@/lib/db");
    const rollups = await fetchSpxAdminRollups();
    grade_breakdown = rollups.grade_breakdown;
    exit_breakdown = rollups.exit_breakdown;
    daily_rollup = rollups.daily_rollup;
    signal_actions_30d = rollups.signal_actions_30d;
    signals_today = rollups.signals_today;
    flow_alerts_today = rollups.flow_alerts_today;
    open_outcomes = rollups.open_outcomes;
    avg_pnl_pts = rollups.avg_pnl_pts;
    avg_mfe_pts = rollups.avg_mfe_pts;
    avg_mae_pts = rollups.avg_mae_pts;
    recent_signals = rollups.recent_signals;
  }

  const insights = insightsFromAnalytics(outcome_stats, adaptive, grade_breakdown);

  return {
    db_configured: configured,
    outcome_stats,
    adaptive,
    grade_breakdown,
    exit_breakdown,
    daily_rollup,
    signal_actions_30d,
    signals_today,
    flow_alerts_today,
    open_outcomes,
    avg_pnl_pts,
    avg_mfe_pts,
    avg_mae_pts,
    insights,
    recent_outcomes,
    recent_signals,
  };
}
