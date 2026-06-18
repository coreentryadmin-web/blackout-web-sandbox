import * as playConfig from "@/lib/spx-play-config";
import { polygonConfigured, uwConfigured, finnhubConfigured } from "@/lib/providers/config";
import { anthropicConfigured } from "@/lib/providers/anthropic";
import { dbConfigured } from "@/lib/db";
import { engineConfigured } from "@/lib/engine";

export type ConfigSnapshotGroup = {
  id: string;
  label: string;
  items: Array<{ key: string; value: string | number | boolean }>;
};

export function buildSpxConfigSnapshot(): ConfigSnapshotGroup[] {
  return [
    {
      id: "scoring",
      label: "Scoring & grades",
      items: [
        { key: "SPX_PLAY_STARTER_MIN_SCORE", value: playConfig.playStarterMinScore() },
        { key: "SPX_PLAY_FULL_MIN_SCORE", value: playConfig.playFullMinScore() },
        { key: "SPX_PLAY_WATCH_MIN_SCORE", value: playConfig.playWatchMinScore() },
        { key: "SPX_PLAY_PROMOTE_MIN_SCORE", value: playConfig.playPromoteMinScore() },
        { key: "SPX_PLAY_MIN_GRADE", value: "B (rank " + playConfig.playMinGradeRank() + ")" },
        { key: "SPX_PLAY_MIN_AGREEING_FACTORS", value: playConfig.playMinAgreeingFactors() },
        { key: "SPX_PLAY_WEIGHTED_CONFLICT_BLOCK_MIN", value: playConfig.playWeightedConflictBlockMin() },
        { key: "SPX_PLAY_MIN_CONFIRMATIONS", value: playConfig.playMinConfirmationsRequired() },
      ],
    },
    {
      id: "cooldowns",
      label: "Cooldowns & session",
      items: [
        { key: "SPX_PLAY_BUY_COOLDOWN_SEC", value: playConfig.playBuyCooldownSec() },
        { key: "SPX_PLAY_BUY_COOLDOWN_APLUS_BYPASS", value: playConfig.playBuyCooldownAplusBypass() },
        { key: "SPX_PLAY_REENTRY_LOCK_SEC", value: playConfig.playReentryLockSec() },
        { key: "SPX_PLAY_COOLDOWN_AFTER_STOP_MIN", value: playConfig.playCooldownAfterStopMin() },
        { key: "SPX_PLAY_NO_ENTRY_ET", value: `${playConfig.playNoEntryAfterEtHour()}:${String(playConfig.playNoEntryAfterEtMin()).padStart(2, "0")}` },
        { key: "SPX_PLAY_FORCE_EXIT_ET", value: `${playConfig.playForceExitEtHour()}:${String(playConfig.playForceExitEtMin()).padStart(2, "0")}` },
        { key: "SPX_PLAY_OPENING_RANGE_MINUTES", value: playConfig.playOpeningRangeMinutes() },
      ],
    },
    {
      id: "exits",
      label: "Exits & trims",
      items: [
        { key: "SPX_PLAY_TRIM_MFE_PTS", value: playConfig.playTrimMfePts() },
        { key: "SPX_PLAY_TRIM_PROGRESS_PCT", value: playConfig.playTrimProgressPct() },
        { key: "SPX_PLAY_THESIS_BREAK_SCORE", value: playConfig.playThesisBreakScore() },
        { key: "SPX_PLAY_THESIS_BREAK_DROP_PTS", value: playConfig.playThesisBreakDropPts() },
        { key: "SPX_PLAY_GEX_STALE_MAX_SEC", value: playConfig.playGexStaleMaxSec() },
      ],
    },
    {
      id: "watch",
      label: "Watch & promote",
      items: [
        { key: "SPX_PLAY_WATCH_MAX_AGE_MIN", value: playConfig.playWatchMaxAgeMin() },
        { key: "SPX_PLAY_WATCH_EXTEND_AGE_MIN", value: playConfig.playWatchExtendAgeMin() },
        { key: "SPX_WATCH_ENTRY_MAX_PRICE_DRIFT_PTS", value: playConfig.playWatchEntryMaxPriceDriftPts() },
        { key: "SPX_PLAY_ONLY_FULL_ENTRY", value: playConfig.playOnlyFullEntry() },
      ],
    },
    {
      id: "options",
      label: "Options chain",
      items: [
        { key: "SPX_OPTION_CHAIN_REQUIRED", value: playConfig.playOptionChainRequired() },
        { key: "SPX_CHAIN_MAX_SPREAD_PCT", value: playConfig.playChainMaxSpreadPct() },
        { key: "SPX_CHAIN_MAX_SPREAD_PCT_OPEN", value: playConfig.playChainMaxSpreadPctOpen() },
        { key: "SPX_CHAIN_OPEN_SPREAD_MINUTES", value: playConfig.playChainOpenSpreadMinutes() },
      ],
    },
    {
      id: "lotto",
      label: "Lotto track",
      items: [
        { key: "SPX_PLAY_LOTTO_MIN_SCORE", value: playConfig.playLottoMinScore() },
        { key: "SPX_PLAY_LOTTO_TARGET_PTS", value: playConfig.playLottoTargetPts() },
        { key: "SPX_PLAY_IDEAL_TARGET_PTS", value: playConfig.playIdealTargetPts() },
        { key: "SPX_PLAY_LOTTO_MAX_PICKS", value: playConfig.playLottoMaxPicksPerDay() },
        { key: "SPX_PLAY_LOTTO_FLOW_MIN", value: playConfig.playLottoFlowMinNotional() },
        { key: "SPX_PLAY_LOTTO_GAP_MIN_PCT", value: playConfig.playLottoGapMinPct() },
        { key: "SPX_PLAY_LOTTO_CONFIRM_MOVE_PTS", value: playConfig.playLottoConfirmMovePts() },
        { key: "SPX_LOTTO_CHAIN_MAX_SPREAD_PCT", value: playConfig.playLottoChainMaxSpreadPct() },
      ],
    },
    {
      id: "adaptive",
      label: "Adaptive telemetry",
      items: [
        { key: "SPX_OUTCOME_MIN_TRADES", value: playConfig.outcomeAdaptiveMinTrades() },
        { key: "SPX_OUTCOME_MIN_DAYS", value: playConfig.outcomeAdaptiveMinDays() },
        { key: "SPX_ADAPTIVE_MIN_WIN_RATE", value: playConfig.outcomeMinWinRate() },
        { key: "SPX_PROMOTE_UNDERPERFORM_GAP", value: playConfig.promoteUnderperformGap() },
        { key: "SPX_PROMOTE_SCORE_BOOST", value: playConfig.promoteUnderperformScoreBoost() },
      ],
    },
    {
      id: "claude",
      label: "Claude gate",
      items: [
        { key: "SPX_CLAUDE_GATE", value: playConfig.playClaudeGateEnabled() },
        { key: "SPX_CLAUDE_PLAY_CACHE_SEC", value: playConfig.playClaudeCacheSec() },
        { key: "ANTHROPIC_CONFIGURED", value: anthropicConfigured() },
      ],
    },
    {
      id: "providers",
      label: "Data providers",
      items: [
        { key: "POLYGON", value: polygonConfigured() },
        { key: "UNUSUAL_WHALES", value: uwConfigured() },
        { key: "FINNHUB", value: finnhubConfigured() },
        { key: "BLACKOUT_ENGINE", value: engineConfigured() },
        { key: "POSTGRES", value: dbConfigured() },
      ],
    },
  ];
}
