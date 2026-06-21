import {
  outcomeAdaptiveMinDays,
  outcomeAdaptiveMinPathTrades,
  outcomeAdaptiveMinTrades,
  outcomeMinWinRate,
  promoteUnderperformGap,
  promoteUnderperformScoreBoost,
} from "@/lib/spx-play-config";
import { fetchPlayOutcomeStats, type PlayOutcomeStats } from "@/lib/spx-play-outcomes";
import { todayEtYmd } from "@/lib/providers/spx-session";

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

// TL-3: Cache key includes session date so the cache auto-invalidates on date change.
let cached: { key: string; gates: AdaptivePlayGates; at: number } | null = null;
const CACHE_MS = 5 * 60_000;

export async function loadAdaptivePlayGates(): Promise<AdaptivePlayGates> {
  const now = Date.now();
  const cacheKey = todayEtYmd();
  if (cached && cached.key === cacheKey && now - cached.at < CACHE_MS) return cached.gates;

  const stats = await fetchPlayOutcomeStats();
  const gates = computeAdaptiveGates(stats);
  cached = { key: cacheKey, at: now, gates };
  return gates;
}

export function computeAdaptiveGates(stats: PlayOutcomeStats): AdaptivePlayGates {
  const minTrades = outcomeAdaptiveMinTrades();
  const minDays = outcomeAdaptiveMinDays();
  const minPathTrades = outcomeAdaptiveMinPathTrades();
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

    if (promote.count >= minPathTrades && cold.count >= minPathTrades) {
      const gap = cold.win_rate - promote.win_rate;
      // TL-1: If promote win_rate has recovered above 30%, reset any penalty.
      if (promote.win_rate > 0.3) {
        promote_min_score_boost = 0;
      } else if (gap >= promoteUnderperformGap()) {
        promote_min_score_boost = promoteUnderperformScoreBoost();
        promote_requires_claude = true;
        notes.push(
          `WATCH→ENTRY ${(promote.win_rate * 100).toFixed(0)}% vs cold ${(cold.win_rate * 100).toFixed(0)}% — promote +${promote_min_score_boost} score`
        );
      }
      if (gap >= promoteUnderperformGap() * 2 && promote.win_rate < 0.35) {
        promote_blocked = true;
        // TL-2: When promote is blocked, clear boost to avoid dual confusing signals.
        promote_min_score_boost = 0;
        promote_block_reason = `WATCH→ENTRY underperforming (${(promote.win_rate * 100).toFixed(0)}% win rate)`;
        notes.push("promote path blocked until stats improve");
      }
    }
    // TL-1: Only apply early-run penalty after at least minPathTrades samples —
    // sparse early data is too noisy to warrant a permanent +5 boost.
    // No penalty for fewer samples; if win_rate > 0.3 at any sample size, no penalty.
    if (
      promote.count >= minPathTrades &&
      promote.win_rate === 0 &&
      cold.count < minPathTrades
    ) {
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
