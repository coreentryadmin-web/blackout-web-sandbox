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

/**
 * Minimum |score| for a starter (half-size) entry. Below fullMin (58) but above watch
 * floor (38). Raise to match playFullMinScore() to effectively disable starter entries
 * without toggling playOnlyFullEntry().
 */
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

/**
 * When true, only A/A+ full-size entries are allowed — starter/half-size entries are
 * suppressed. Default false (starter entries enabled at lower score thresholds).
 */
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
  // Require explicit SPX_CLAUDE_GATE=1 to enable the Claude gate.
  // Defaulting to true when ANTHROPIC_API_KEY is set surprised operators who
  // configured Anthropic only for commentary. The gate is now opt-in.
  return process.env.SPX_CLAUDE_GATE === "1";
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

/**
 * How many minutes after 9:30 AM ET constitute the "opening range" — BUY entries are
 * blocked during this window (WATCH is still ok). Default 12 min → no BUY until 9:42.
 * At 9:40 only 2 completed 3m bars exist so MTF is thin; 12 minutes captures real
 * continuation breakouts while still filtering the loudest 9:30–9:42 false moves.
 * Set to 30 for a full opening-range bar strategy, or 0 to disable the guard.
 */
export function playOpeningRangeMinutes(): number {
  return num(process.env.SPX_PLAY_OPENING_RANGE_MINUTES, 12);
}

/**
 * Minutes to block all entries after a stop-out. Default 15 min — enough for chop
 * that caused the stop to resolve without burning a large chunk of the 0DTE day.
 * (20 min is too long: a 2:30 PM stop locks the engine until 2:50, leaving only 40
 * minutes of tradeable session.) The same-direction re-entry lock runs concurrently,
 * so both reset at the same time.
 */
export function playCooldownAfterStopMin(): number {
  return num(process.env.SPX_PLAY_COOLDOWN_AFTER_STOP_MIN, 15);
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

/**
 * Minimum SPX point move targeted by a far-OTM lotto play. Default 25 pts — these are
 * thesis bets expecting a significant intraday move, sized at 25–50% of standard play.
 */
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

/**
 * SPX pts of price movement required to confirm lotto entry from the open anchor.
 * Default 5 pts — enough to confirm directional intent without burning too much of
 * the 25-pt target before entry. The hard stop after entry is playLottoStopLossPts().
 */
export function playLottoConfirmMovePts(): number {
  return num(process.env.SPX_PLAY_LOTTO_CONFIRM_MOVE_PTS, 5);
}

/**
 * Hard stop loss for an open lotto position in SPX pts.
 * Default 8 pts — gives the trade room to breathe after the 5-pt confirm move,
 * while keeping risk reasonable vs the 25-pt target (1:3+ R:R minimum).
 */
export function playLottoStopLossPts(): number {
  return num(process.env.SPX_LOTTO_STOP_LOSS_PTS, 8);
}

export function playLottoExpireEtHour(): number {
  return num(process.env.SPX_PLAY_LOTTO_EXPIRE_ET_HOUR, 10);
}

export function playLottoExpireEtMin(): number {
  return num(process.env.SPX_PLAY_LOTTO_EXPIRE_ET_MIN, 30);
}

/**
 * ET hour after which NO new lotto entries or scans are allowed (intraday cutoff).
 * Default 14 (2:00 PM) — allows the lotto engine to catch intraday catalyst moves
 * (Fed speakers, data releases, sector rotations) that develop after the 10:30 AM
 * opening-range expiry. Still well before power-hour where theta decay is brutal.
 */
export function playLottoIntradayCutoffEtHour(): number {
  return num(process.env.SPX_PLAY_LOTTO_INTRADAY_CUTOFF_ET_HOUR, 14);
}

export function playLottoIntradayCutoffEtMin(): number {
  return num(process.env.SPX_PLAY_LOTTO_INTRADAY_CUTOFF_ET_MIN, 0);
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

/**
 * Weighted conflict score at which entry is blocked. Hard opposing factors (tide, GEX,
 * dark pool) count 2×; soft factors count 1×. Default inherits playConflictBlockMin()
 * (4). Setting this higher than playConflictBlockMin() lets minor conflicts through
 * while still blocking structurally conflicted setups.
 */
export function playWeightedConflictBlockMin(): number {
  return num(process.env.SPX_PLAY_WEIGHTED_CONFLICT_BLOCK_MIN, playConflictBlockMin());
}

/**
 * MTF confirmation buffer in SPX points. A 3m close must clear the key level by at
 * least this amount to count as confirmed. Default 1.0 — anything below 1 pt is below
 * SPX tick noise and produces false positives (e.g. 5596.25 "confirming" a 5596.00 level).
 */
export function playMtfBufferPts(): number {
  return num(process.env.SPX_PLAY_MTF_BUFFER_PTS, 1.0);
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

/**
 * MFE in SPX pts at which the trailing stop locks in at entry price (breakeven).
 * Default 8 pts — below this SPX moves 4–7 pts in normal noise, breakevening
 * valid runners. At 8 pts the move is meaningful and worth protecting.
 */
export function playTrailingStopBreakevenMfePts(): number {
  return num(process.env.SPX_TRAILING_STOP_BREAKEVEN_MFE, 8);
}

/**
 * MFE in SPX pts at which the trailing stop switches from breakeven to a price-trail.
 * Default 15 pts — beyond this the trade has a solid run and we trail the stop at
 * peak MFE minus playTrailingStopTrailWindowPts() to lock in most of the move.
 */
export function playTrailingStopTrailMfePts(): number {
  return num(process.env.SPX_TRAILING_STOP_TRAIL_MFE, 15);
}

/**
 * Trail window in SPX pts — how far below peak MFE the trailing stop sits once
 * trailing is active. Default 7 pts. Pairs with the trim-at-70% mechanism
 * (which fires at MFE >= 12 pts): trim takes half off at +12, trail protects the rest.
 */
export function playTrailingStopTrailWindowPts(): number {
  return num(process.env.SPX_TRAILING_STOP_TRAIL_WINDOW, 7);
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
