/** Play engine thresholds — quality over quantity. */
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import { playbookDef } from "@/features/spx/lib/playbook-registry";
import {
  PLAYBOOK_PAPER_EXECUTABLE_DEFAULT,
  executionModeMeets,
} from "@/features/spx/lib/playbook-execution-mode";
import { isStagingDeploy } from "@/lib/clerk-env";

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
  // Was 58 — compound gate audit showed max reliable score on quiet days is 40-55.
  // 52 keeps the quality bar high while allowing B-grade setups to qualify.
  return num(process.env.SPX_PLAY_FULL_MIN_SCORE, 52);
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
  // Was 4 — at score 48-57 (grade B) there are typically 3-5 total factors; requiring
  // 4 agreeing silently killed entry_mode for valid B setups. 3 is still selective.
  return num(process.env.SPX_PLAY_MIN_AGREEING_FACTORS, 3);
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

/** A+ setups alert on buy cooldown but do not block entry. Default off — Jul 6 A+ re-fired after loss. */
export function playBuyCooldownAplusBypass(): boolean {
  return flag(process.env.SPX_PLAY_BUY_COOLDOWN_APLUS_BYPASS, false);
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
  // Staging exercises the full BIE precedent path; production stays opt-in unless set.
  return isStagingDeploy();
}

export function playClaudeCacheSec(): number {
  return num(process.env.SPX_CLAUDE_PLAY_CACHE_SEC, 60);
}

export function playTrimMfePts(): number {
  return num(process.env.SPX_PLAY_TRIM_MFE_PTS, 12);
}

/** VIX-indexed trim arm — low-VIX days move less; trim earlier to lock partial gains. */
export function playDynamicTrimMfePts(vix?: number | null): number {
  if (process.env.SPX_PLAY_TRIM_MFE_PTS) return playTrimMfePts();
  if (vix != null && vix > 22) return 14;
  if (vix != null && vix > 16) return 12;
  return 10;
}

export function playThesisBreakScore(): number {
  return num(process.env.SPX_PLAY_THESIS_BREAK_SCORE, 40);
}

export function playThesisBreakDropPts(): number {
  // Was 12 — track record showed 9/13 losses via THESIS with MFE=0: score whipsaw on
  // mixed tape exited before structure (stop) could decide. 18 gives more room.
  return num(process.env.SPX_PLAY_THESIS_BREAK_DROP_PTS, 18);
}

/**
 * Minimum MFE (SPX pts) before a score-*drop* thesis break can fire. Floor breaks
 * (absolute adverse confluence) still exit immediately. Prevents hair-trigger flats
 * when the tape never moved in favor (11/13 historical losses had MFE=0).
 */
export function playThesisBreakMinMfePts(): number {
  return num(process.env.SPX_PLAY_THESIS_BREAK_MIN_MFE_PTS, 2);
}

/** Minimum seconds in-trade before score-drop thesis break (floor still immediate). */
export function playThesisBreakMinHoldSec(): number {
  return num(process.env.SPX_PLAY_THESIS_BREAK_MIN_HOLD_SEC, 180);
}

/**
 * Minimum |score| for cold BUY (no prior WATCH). WATCH→ENTRY promote bypasses this.
 * Cold path win rate was 17% vs 38% promote — default 68 keeps B-grade cold entries out.
 */
export function playColdBuyMinScore(): number {
  return num(process.env.SPX_PLAY_COLD_BUY_MIN_SCORE, 68);
}

/** Max closed losses per ET session before new BUY entries block (WATCH ok). */
export function playSessionMaxLosses(): number {
  return num(process.env.SPX_PLAY_SESSION_MAX_LOSSES, 3);
}

/** Max entries per ET session before new BUY blocks (Jul 6 churn: 7 plays / 4 losses). */
export function playSessionMaxEntries(): number {
  return num(process.env.SPX_PLAY_SESSION_MAX_ENTRIES, 5);
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
  // 3:45 PM — moved from 3:50: the last 15 min has extreme theta/spread collapse on 0DTE.
  return num(process.env.SPX_PLAY_FORCE_EXIT_ET_MIN, 45);
}

/**
 * Validates that no-entry cutoff is before force-exit cutoff, preventing a
 * misconfiguration where a BUY entry fires moments before theta force-exit.
 * Called at startup — logs a warning but does not crash the server.
 */
export function warnIfPlayTimingMisconfigured(): void {
  const noEntryMins = playNoEntryAfterEtHour() * 60 + playNoEntryAfterEtMin();
  const forceExitMins = playForceExitEtHour() * 60 + playForceExitEtMin();
  if (noEntryMins >= forceExitMins) {
    console.warn(
      `[spx-play-config] TIMING MISCONFIGURATION: no-entry cutoff (${playNoEntryAfterEtHour()}:${String(playNoEntryAfterEtMin()).padStart(2, "0")}) ` +
      `is at or after force-exit (${playForceExitEtHour()}:${String(playForceExitEtMin()).padStart(2, "0")}). ` +
      `New entries could be opened immediately before force-exit fires.`
    );
  }
}

/**
 * How many minutes after 9:30 AM ET constitute the "opening range" — BUY entries are
 * blocked during this window (WATCH is still ok). Default 12 min → no BUY until 9:42.
 * At 9:40 only 2 completed 3m bars exist so MTF is thin; 12 minutes captures real
 * continuation breakouts while still filtering the loudest 9:30–9:42 false moves.
 * 20 min (→ 9:50 earliest entry) gives the true ORB time to be confirmed; 12 was too early.
 * Set to 30 for a full opening-range bar strategy, or 0 to disable the guard.
 */
export function playOpeningRangeMinutes(): number {
  return num(process.env.SPX_PLAY_OPENING_RANGE_MINUTES, 20);
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

/**
 * VIX-indexed dynamic target in SPX pts.
 * Low-vol markets (VIX <16) have tighter intraday ranges — 8 pts is realistic.
 * Normal markets (VIX 16-22) average 25-40 pt days — 12 pts is a good scalp.
 * High-vol markets (VIX >22) can move 60-100 pts — 18 pts captures a meaningful slice.
 * An explicit SPX_PLAY_IDEAL_TARGET_PTS env override disables the VIX indexing entirely.
 */
export function playDynamicTargetPts(vix?: number | null): number {
  if (process.env.SPX_PLAY_IDEAL_TARGET_PTS) return num(process.env.SPX_PLAY_IDEAL_TARGET_PTS, 10);
  if (vix != null && vix > 22) return 18;
  if (vix != null && vix > 16) return 14;
  // Was 8 — made R:R gate fail for virtually every low-VIX day. GEX stop walls are
  // typically 8-14 pts away; an 8-pt target with 1.5 R:R requires the stop within 5.3 pts.
  // 12 pts is the minimum realistic scalp target even in calm markets.
  return 12;
}

/**
 * VIX-indexed trail window in SPX pts.
 * A 7-pt trail on a VIX-25 day gets stopped out by normal noise. Scale with vol:
 * VIX <16 → 6 pts (quiet market), 16-22 → 9 pts (normal chop), >22 → 13 pts (volatile).
 * An explicit SPX_TRAILING_STOP_TRAIL_WINDOW env override disables VIX indexing.
 */
export function playDynamicTrailWindowPts(vix?: number | null): number {
  if (process.env.SPX_TRAILING_STOP_TRAIL_WINDOW) return num(process.env.SPX_TRAILING_STOP_TRAIL_WINDOW, 7);
  if (vix != null && vix > 22) return 13;
  if (vix != null && vix > 16) return 9;
  return 6;
}

/**
 * Minimum acceptable risk:reward ratio before a BUY entry is allowed.
 * Default 1.5 — target must be at least 1.5× the distance to the stop.
 * Only enforced when both stop and target are non-null. Null-stop plays are
 * not blocked here (they have their own invalidation text warning).
 */
export function playMinRiskReward(): number {
  // Was 1.5 — combined with the old 8-pt low-VIX target, this required the stop
  // within 5.3 pts of price (virtually never true for GEX walls). Now 1.2 with 12-pt
  // target allows stops up to 10 pts, matching typical GEX wall distances.
  return num(process.env.SPX_PLAY_MIN_RISK_REWARD, 1.2);
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

/**
 * Maximum distance in SPX pts at which a level counts as "nearby."
 * Default 10 pts — at 22 pts (old default) a support 22 pts below price was considered
 * "at support" while the target was only 8-12 pts away, creating a default -R:R entry.
 * 10 pts is meaningful proximity for 0DTE scalp trades.
 */
export function playStructureProximityPts(): number {
  return num(process.env.SPX_PLAY_STRUCTURE_PROX_PTS, 10);
}

export function playMinConfirmationsRequired(): number {
  // Was 6 of 11 total checks. 5 is still meaningful given 4 required checks must all pass.
  return num(process.env.SPX_PLAY_MIN_CONFIRMATIONS, 5);
}

export function playTechnicalsCacheSec(): number {
  return num(process.env.SPX_PLAY_TECHNICALS_CACHE_SEC, 30);
}

/**
 * Staging-only playbook lab — relaxed starter entries when a primary playbook fires
 * and direction aligns. Always on when `isStagingDeploy()` (staging URL baked at build).
 * Not env-toggleable: staging exists to exercise playbook-gated BUY before prod.
 */
export function playbookStagingLabEnabled(): boolean {
  return isStagingDeploy();
}

/**
 * Phase 3 playbook live gate — when true, BUY requires `primary_playbook_id` from the matcher.
 * Always on staging (via playbook lab). Prod: set `PLAYBOOK_LIVE_GATE=1` explicitly.
 */
export function playbookLiveGateEnabled(): boolean {
  if (playbookStagingLabEnabled()) return true;
  return flag(process.env.PLAYBOOK_LIVE_GATE, false);
}

/** Default staging paper-executable set — high-fidelity only (PB-04 mvp stays shadow). */
export const PLAYBOOK_LIVE_ALLOWLIST_DEFAULT_STAGING: readonly PlaybookId[] =
  PLAYBOOK_PAPER_EXECUTABLE_DEFAULT;

const VALID_PLAYBOOK_IDS = new Set<PlaybookId>([
  "PB-01",
  "PB-02",
  "PB-03",
  "PB-04",
  "PB-05",
  "PB-06",
  "PB-07",
  "PB-08",
  "PB-09",
  "PB-10",
  "PB-11",
  "PB-12",
  "PB-13",
  "PB-14",
]);

/**
 * Parse `PLAYBOOK_LIVE_ALLOWLIST` (comma-separated PB ids).
 * - `*` or `all` → null (no filter — escape hatch for research)
 * - unset on staging → PB-01…04 default
 * - unset on prod → null until explicitly configured
 */
export function parsePlaybookLiveAllowlist(
  raw: string | undefined,
  stagingDeploy: boolean
): ReadonlySet<PlaybookId> | null {
  const trimmed = raw?.trim();
  if (trimmed) {
    if (trimmed === "*" || trimmed.toLowerCase() === "all") return null;
    const ids = trimmed
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((id): id is PlaybookId => VALID_PLAYBOOK_IDS.has(id as PlaybookId));
    return ids.length ? new Set(ids) : null;
  }
  if (stagingDeploy) return new Set(PLAYBOOK_LIVE_ALLOWLIST_DEFAULT_STAGING);
  return null;
}

/** All registered playbook ids — the STAGING full-enablement set. */
const ALL_PLAYBOOK_IDS: readonly PlaybookId[] = [...VALID_PLAYBOOK_IDS];

/** When non-null, gate A17 only permits BUY for these primary playbook ids. */
export function playbookLiveAllowlist(): ReadonlySet<PlaybookId> | null {
  // STAGING FULL-ENABLEMENT (user directive): on staging every playbook (PB-01..PB-14) is allowlisted
  // so the WHOLE SPX Slayer engine runs live to test + measure. An explicit env override still wins
  // (research escape hatch). PROD IS UNCHANGED — prod keeps the env/high-fidelity default below.
  if (isStagingDeploy() && !process.env.PLAYBOOK_LIVE_ALLOWLIST?.trim()) {
    return new Set(ALL_PLAYBOOK_IDS);
  }
  return parsePlaybookLiveAllowlist(process.env.PLAYBOOK_LIVE_ALLOWLIST, isStagingDeploy());
}

export function isPlaybookLiveAllowlisted(id: PlaybookId | null | undefined): boolean {
  if (!id) return false;
  // STAGING FULL-ENABLEMENT: every playbook is paper-executable on staging (test bed), so the
  // execution-mode gate (which keeps mvp matchers shadow-only on prod) is lifted here. PROD UNCHANGED.
  if (isStagingDeploy() && !process.env.PLAYBOOK_LIVE_ALLOWLIST?.trim()) {
    return VALID_PLAYBOOK_IDS.has(id);
  }
  const def = playbookDef(id);
  const allowlist = playbookLiveAllowlist();
  if (allowlist == null) {
    return executionModeMeets(def.execution_mode, "paper_executable");
  }
  return allowlist.has(id) && executionModeMeets(def.execution_mode, "paper_executable");
}

/** Minimum |0DTE net flow| for playbook trigger materiality (PB-02 v2). */
export function playbookFlowMaterialityMin(): number {
  return num(process.env.PLAYBOOK_FLOW_MATERIALITY_MIN, 100_000);
}

/** Shared cache for GET /api/market/spx/play — collapses member polls into one eval per window. */
export function playMemberReadCacheSec(): number {
  return num(process.env.SPX_PLAY_MEMBER_READ_CACHE_SEC, 2);
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

/**
 * When TRUE, a missing/illiquid 0DTE option chain VETOES opening an otherwise
 * approved A-grade play (engine returns SCANNING). This previously defaulted TRUE,
 * which — combined with the wrong-underlying chain-fetch bug — meant approved plays
 * NEVER opened and the outcome ledger stayed empty forever.
 *
 * Defaults FALSE: an approved play OPENS using the index-plan fallback ticket
 * (buildOptionTicket emits a fallback strike with block_reason "No liquid chain
 * match — index plan only") rather than being silently vetoed. The chain is a
 * presentation/sizing aid, not an entry gate — the entry decision is the confluence
 * + Claude approval on the index. Set SPX_OPTION_CHAIN_REQUIRED=true to restore the
 * hard gate.
 */
export function playOptionChainRequired(): boolean {
  return flag(process.env.SPX_OPTION_CHAIN_REQUIRED, false);
}

export function outcomeAdaptiveMinTrades(): number {
  // Was 30 — ledger had 19 closes; adaptive never armed at 32% WR. 15 activates self-tightening.
  return num(process.env.SPX_OUTCOME_MIN_TRADES, 15);
}

export function outcomeAdaptiveMinDays(): number {
  return num(process.env.SPX_OUTCOME_MIN_DAYS, 8);
}

/** Minimum closed trades per entry path before path-split telemetry adjusts promote gates. */
export function outcomeAdaptiveMinPathTrades(): number {
  return num(process.env.SPX_OUTCOME_MIN_PATH_TRADES, 5);
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

// ---------------------------------------------------------------------------
// Power Hour Lotto — 2:45–3:15 PM ET near-money momentum plays
// ---------------------------------------------------------------------------

/** ET hour when the power hour window opens. Default 14 (2:00 PM). */
export function playPowerHourStartEtHour(): number {
  return num(process.env.SPX_POWER_HOUR_START_ET_HOUR, 14);
}
export function playPowerHourStartEtMin(): number {
  return num(process.env.SPX_POWER_HOUR_START_ET_MIN, 45);
}
/** ET hour when the power hour window closes (force-exit). Default 15 (3:00 PM). */
export function playPowerHourEndEtHour(): number {
  return num(process.env.SPX_POWER_HOUR_END_ET_HOUR, 15);
}
export function playPowerHourEndEtMin(): number {
  return num(process.env.SPX_POWER_HOUR_END_ET_MIN, 15);
}
/**
 * Target in SPX pts for power hour plays. Default 13 pts.
 * Near-money 0DTE options (8 pts OTM) have high gamma — 13 pts is realistic
 * on a directional power-hour push with 30–45 min left until close.
 */
export function playPowerHourTargetPts(): number {
  return num(process.env.SPX_POWER_HOUR_TARGET_PTS, 13);
}
/** Hard stop in SPX pts. Default 4 pts — tight because theta burns fast. */
export function playPowerHourStopLossPts(): number {
  return num(process.env.SPX_POWER_HOUR_STOP_LOSS_PTS, 4);
}
/** Minimum SPX move from anchor to confirm WATCH → HOLD. Default 3 pts. */
export function playPowerHourConfirmMovePts(): number {
  return num(process.env.SPX_POWER_HOUR_CONFIRM_MOVE_PTS, 3);
}
/** Maximum option premium for power hour plays. Default $0.50. */
export function playPowerHourMaxPremium(): number {
  return num(process.env.SPX_POWER_HOUR_MAX_PREMIUM, 0.5);
}
/** OTM offset in SPX pts for strike selection. Default 8 pts. */
export function playPowerHourStrikeOffsetPts(): number {
  return num(process.env.SPX_POWER_HOUR_STRIKE_OFFSET_PTS, 8);
}
/** Minimum abs confluence score to trigger a power hour WATCH. Default 45. */
export function playPowerHourMinScore(): number {
  return num(process.env.SPX_POWER_HOUR_MIN_SCORE, 45);
}
/** Unconfirmed WATCHes expire this many minutes before the window closes. Default 5. */
export function playPowerHourWatchExpiryMarginMin(): number {
  return num(process.env.SPX_POWER_HOUR_WATCH_EXPIRY_MARGIN_MIN, 5);
}

export const POWER_HOUR_SIZING_NOTE =
  "Power hour sizing: 25–50% of standard size. Fast theta — confirm quickly, cut losses immediately.";
