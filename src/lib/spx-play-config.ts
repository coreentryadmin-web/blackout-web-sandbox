/** Play engine thresholds — quality over quantity. */

function num(env: string | undefined, fallback: number): number {
  const n = Number(env?.trim());
  return Number.isFinite(n) ? n : fallback;
}

function flag(env: string | undefined, fallback: boolean): boolean {
  if (!env?.trim()) return fallback;
  const v = env.trim().toLowerCase();
  return v === "1" || v === "true";
}

export function playStarterMinScore(): number {
  return num(process.env.SPX_PLAY_STARTER_MIN_SCORE, 48);
}

export function playFullMinScore(): number {
  return num(process.env.SPX_PLAY_FULL_MIN_SCORE, 58);
}

export function playWatchMinScore(): number {
  return num(process.env.SPX_PLAY_WATCH_MIN_SCORE, 38);
}

export function playPromoteMinScore(): number {
  return num(process.env.SPX_PLAY_PROMOTE_MIN_SCORE, 48);
}

export function playConflictBlockMin(): number {
  return num(process.env.SPX_PLAY_CONFLICT_BLOCK_MIN, 4);
}

export function playMinAgreeingFactors(): number {
  return num(process.env.SPX_PLAY_MIN_AGREEING_FACTORS, 4);
}

export function playMinGradeRank(): number {
  const g = process.env.SPX_PLAY_MIN_GRADE?.trim().toUpperCase() ?? "B";
  const ranks: Record<string, number> = { D: 0, C: 1, B: 2, A: 3, "A+": 4 };
  return ranks[g] ?? 2;
}

export function playOnlyFullEntry(): boolean {
  return flag(process.env.SPX_PLAY_ONLY_FULL_ENTRY, false);
}

export function playBuyCooldownSec(): number {
  return num(process.env.SPX_PLAY_BUY_COOLDOWN_SEC, 600);
}

/** A+ setups alert on buy cooldown but do not block entry (default on). */
export function playBuyCooldownAplusBypass(): boolean {
  return flag(process.env.SPX_PLAY_BUY_COOLDOWN_APLUS_BYPASS, true);
}

export function playReentryLockSec(): number {
  return num(process.env.SPX_PLAY_REENTRY_LOCK_SEC, 1200);
}

export function playGexStaleMaxSec(): number {
  return num(process.env.SPX_PLAY_GEX_STALE_MAX_SEC, 90);
}

export function playClaudeGateEnabled(): boolean {
  const raw = process.env.SPX_CLAUDE_GATE?.trim().toLowerCase();
  if (raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function playClaudeCacheSec(): number {
  return num(process.env.SPX_CLAUDE_PLAY_CACHE_SEC, 60);
}

export function playTrimMfePts(): number {
  return num(process.env.SPX_PLAY_TRIM_MFE_PTS, 12);
}

export function playThesisBreakScore(): number {
  return num(process.env.SPX_PLAY_THESIS_BREAK_SCORE, 40);
}

export function playThesisBreakDropPts(): number {
  return num(process.env.SPX_PLAY_THESIS_BREAK_DROP_PTS, 12);
}

export function playNoEntryAfterEtHour(): number {
  return num(process.env.SPX_PLAY_NO_ENTRY_ET_HOUR, 15);
}

export function playNoEntryAfterEtMin(): number {
  return num(process.env.SPX_PLAY_NO_ENTRY_ET_MIN, 30);
}

export function playForceExitEtHour(): number {
  return num(process.env.SPX_PLAY_FORCE_EXIT_ET_HOUR, 15);
}

export function playForceExitEtMin(): number {
  return num(process.env.SPX_PLAY_FORCE_EXIT_ET_MIN, 50);
}

export function playOpeningRangeMinutes(): number {
  return num(process.env.SPX_PLAY_OPENING_RANGE_MINUTES, 15);
}

export function playCooldownAfterStopMin(): number {
  return num(process.env.SPX_PLAY_COOLDOWN_AFTER_STOP_MIN, 20);
}

export function playTrimProgressPct(): number {
  return num(process.env.SPX_PLAY_TRIM_PROGRESS_PCT, 0.7);
}

export function playWatchMaxAgeMin(): number {
  return num(process.env.SPX_PLAY_WATCH_MAX_AGE_MIN, 30);
}

export function playWatchExtendAgeMin(): number {
  return num(process.env.SPX_PLAY_WATCH_EXTEND_AGE_MIN, 45);
}

export function playChainMaxSpreadPct(): number {
  return num(process.env.SPX_CHAIN_MAX_SPREAD_PCT, 18);
}

/** Looser spread cap for the opening window (volatile SPXW quotes). */
export function playChainMaxSpreadPctOpen(): number {
  return num(process.env.SPX_CHAIN_MAX_SPREAD_PCT_OPEN, 20);
}

/** Minutes after 9:30 AM ET to use the open spread cap. */
export function playChainOpenSpreadMinutes(): number {
  return num(process.env.SPX_CHAIN_OPEN_SPREAD_MINUTES, 30);
}

export function playLottoMinScore(): number {
  return num(process.env.SPX_PLAY_LOTTO_MIN_SCORE, 18);
}

export function playLottoTargetPts(): number {
  return num(process.env.SPX_PLAY_LOTTO_TARGET_PTS, 25);
}

/** Minimum SPX move for far-OTM lotto — target may extend to the next structure level. */
export function playLottoMinTargetPts(): number {
  return playLottoTargetPts();
}

/** Conviction / ideal play target distance (0DTE scalp). */
export function playIdealTargetPts(): number {
  return num(process.env.SPX_PLAY_IDEAL_TARGET_PTS, 10);
}

export function playLottoMaxPicksPerDay(): number {
  return num(process.env.SPX_PLAY_LOTTO_MAX_PICKS, 2);
}

export function playLottoFlowMinNotional(): number {
  return num(process.env.SPX_PLAY_LOTTO_FLOW_MIN, 5_000_000);
}

export function playLottoGapMinPct(): number {
  return num(process.env.SPX_PLAY_LOTTO_GAP_MIN_PCT, 0.4);
}

export function playLottoConfirmMovePts(): number {
  return num(process.env.SPX_PLAY_LOTTO_CONFIRM_MOVE_PTS, 8);
}

export function playLottoExpireEtHour(): number {
  return num(process.env.SPX_PLAY_LOTTO_EXPIRE_ET_HOUR, 10);
}

export function playLottoExpireEtMin(): number {
  return num(process.env.SPX_PLAY_LOTTO_EXPIRE_ET_MIN, 30);
}

export function playLottoMinDirectionSignals(): number {
  return num(process.env.SPX_PLAY_LOTTO_MIN_DIRECTION_SIGNALS, 3);
}

/** Far-OTM lotto chain spread cap — separate from main play (default 50%). */
export function playLottoChainMaxSpreadPct(): number {
  return num(process.env.SPX_LOTTO_CHAIN_MAX_SPREAD_PCT, 50);
}

export const LOTTO_SIZING_NOTE =
  "Lotto sizing: 25–50% of standard play size. These are thesis bets, not conviction plays.";

export function playWeightedConflictBlockMin(): number {
  return num(process.env.SPX_PLAY_WEIGHTED_CONFLICT_BLOCK_MIN, playConflictBlockMin());
}

export function playMtfBufferPts(): number {
  return num(process.env.SPX_PLAY_MTF_BUFFER_PTS, 0.25);
}

export function playStructureProximityPts(): number {
  return num(process.env.SPX_PLAY_STRUCTURE_PROX_PTS, 22);
}

export function playMinConfirmationsRequired(): number {
  return num(process.env.SPX_PLAY_MIN_CONFIRMATIONS, 6);
}

export function playTechnicalsCacheSec(): number {
  return num(process.env.SPX_PLAY_TECHNICALS_CACHE_SEC, 30);
}

export function gradeRank(grade: string): number {
  const ranks: Record<string, number> = { D: 0, C: 1, B: 2, A: 3, "A+": 4 };
  return ranks[grade.toUpperCase()] ?? 0;
}

export function playWatchEntryMaxPriceDriftPts(): number {
  return num(process.env.SPX_WATCH_ENTRY_MAX_PRICE_DRIFT_PTS, 10);
}

/** Relaxed drift cap when WATCH formed during opening range and promote happens after OR ends. */
export function playWatchOpeningRangeDriftPts(): number {
  return num(process.env.SPX_WATCH_OPENING_RANGE_DRIFT_PTS, 25);
}

export function playClaudeDailyMaxCalls(): number {
  return num(process.env.SPX_CLAUDE_DAILY_MAX_CALLS, 40);
}

export function playClaudeCachePriceStepPts(): number {
  return num(process.env.SPX_CLAUDE_CACHE_PRICE_STEP_PTS, 2);
}

export function playLottoMinDirectionWeight(): number {
  return num(process.env.SPX_PLAY_LOTTO_MIN_DIRECTION_WEIGHT, 3);
}

export function playOptionChainRequired(): boolean {
  return flag(process.env.SPX_OPTION_CHAIN_REQUIRED, true);
}

export function outcomeAdaptiveMinTrades(): number {
  return num(process.env.SPX_OUTCOME_MIN_TRADES, 30);
}

export function outcomeAdaptiveMinDays(): number {
  return num(process.env.SPX_OUTCOME_MIN_DAYS, 30);
}

/** Minimum closed trades per entry path before path-split telemetry adjusts promote gates. */
export function outcomeAdaptiveMinPathTrades(): number {
  return num(process.env.SPX_OUTCOME_MIN_PATH_TRADES, 10);
}

export function outcomeMinWinRate(): number {
  return num(process.env.SPX_ADAPTIVE_MIN_WIN_RATE, 0.45);
}

export function promoteUnderperformGap(): number {
  return num(process.env.SPX_PROMOTE_UNDERPERFORM_GAP, 0.15);
}

export function promoteUnderperformScoreBoost(): number {
  return num(process.env.SPX_PROMOTE_SCORE_BOOST, 5);
}
