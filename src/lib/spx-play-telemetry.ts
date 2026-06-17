import {
  outcomeAdaptiveMinDays,
  outcomeAdaptiveMinTrades,
  outcomeMinWinRate,
  promoteUnderperformGap,
  promoteUnderperformScoreBoost,
} from "@/lib/spx-play-config";
import { fetchPlayOutcomeStats, type PlayOutcomeStats } from "@/lib/spx-play-outcomes";

export type AdaptivePlayGates = {
  active: boolean;
  stats: PlayOutcomeStats;
  global_min_score_boost: number;
  promote_min_score_boost: number;
  promote_blocked: boolean;
  promote_requires_claude: boolean;
  promote_block_reason: string | null;
  summary: string;
};

let cached: { at: number; gates: AdaptivePlayGates } | null = null;
const CACHE_MS = 5 * 60_000;

export async function loadAdaptivePlayGates(): Promise<AdaptivePlayGates> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.gates;

  const stats = await fetchPlayOutcomeStats();
  const gates = computeAdaptiveGates(stats);
  cached = { at: now, gates };
  return gates;
}

export function computeAdaptiveGates(stats: PlayOutcomeStats): AdaptivePlayGates {
  const minTrades = outcomeAdaptiveMinTrades();
  const minDays = outcomeAdaptiveMinDays();
  const active =
    stats.total_closed >= minTrades && stats.days_of_data >= minDays;

  let global_min_score_boost = 0;
  let promote_min_score_boost = 0;
  let promote_blocked = false;
  let promote_requires_claude = false;
  let promote_block_reason: string | null = null;
  const notes: string[] = [];

  if (active) {
    if (stats.overall.win_rate < outcomeMinWinRate()) {
      global_min_score_boost = 3;
      notes.push(
        `overall win rate ${(stats.overall.win_rate * 100).toFixed(0)}% — +3 score floor`
      );
    }

    const cold = stats.cold_buy;
    const promote = stats.watch_promote;

    if (promote.count >= 3 && cold.count >= 3) {
      const gap = cold.win_rate - promote.win_rate;
      if (gap >= promoteUnderperformGap()) {
        promote_min_score_boost = promoteUnderperformScoreBoost();
        promote_requires_claude = true;
        notes.push(
          `WATCH→ENTRY ${(promote.win_rate * 100).toFixed(0)}% vs cold ${(cold.win_rate * 100).toFixed(0)}% — promote +${promote_min_score_boost} score`
        );
      }
      if (gap >= promoteUnderperformGap() * 2 && promote.win_rate < 0.35) {
        promote_blocked = true;
        promote_block_reason = `WATCH→ENTRY underperforming (${(promote.win_rate * 100).toFixed(0)}% win rate)`;
        notes.push("promote path blocked until stats improve");
      }
    } else if (promote.count >= 2 && promote.win_rate === 0) {
      promote_min_score_boost = Math.max(promote_min_score_boost, 5);
      notes.push("early promote losses — +5 score on promote");
    }
  }

  const summary = active
    ? notes.length
      ? notes.join(" · ")
      : `telemetry active (${stats.total_closed} trades, ${stats.days_of_data.toFixed(0)}d)`
    : `collecting data (${stats.total_closed}/${minTrades} trades, ${stats.days_of_data.toFixed(0)}/${minDays}d)`;

  return {
    active,
    stats,
    global_min_score_boost,
    promote_min_score_boost,
    promote_blocked,
    promote_requires_claude,
    promote_block_reason,
    summary,
  };
}

export function effectiveFullMinScore(base: number, adaptive: AdaptivePlayGates): number {
  return base + adaptive.global_min_score_boost;
}

export function effectivePromoteMinScore(base: number, adaptive: AdaptivePlayGates): number {
  return base + adaptive.global_min_score_boost + adaptive.promote_min_score_boost;
}
