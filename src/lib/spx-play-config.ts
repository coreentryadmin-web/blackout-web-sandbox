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
  return num(process.env.SPX_PLAY_STARTER_MIN_SCORE, 58);
}

export function playFullMinScore(): number {
  return num(process.env.SPX_PLAY_FULL_MIN_SCORE, 68);
}

export function playWatchMinScore(): number {
  return num(process.env.SPX_PLAY_WATCH_MIN_SCORE, 50);
}

export function playConflictBlockMin(): number {
  return num(process.env.SPX_PLAY_CONFLICT_BLOCK_MIN, 2);
}

export function playMinAgreeingFactors(): number {
  return num(process.env.SPX_PLAY_MIN_AGREEING_FACTORS, 6);
}

export function playMinGradeRank(): number {
  const g = process.env.SPX_PLAY_MIN_GRADE?.trim().toUpperCase() ?? "A";
  const ranks: Record<string, number> = { D: 0, C: 1, B: 2, A: 3, "A+": 4 };
  return ranks[g] ?? 3;
}

export function playOnlyFullEntry(): boolean {
  return flag(process.env.SPX_PLAY_ONLY_FULL_ENTRY, true);
}

export function playBuyCooldownSec(): number {
  return num(process.env.SPX_PLAY_BUY_COOLDOWN_SEC, 600);
}

export function playReentryLockSec(): number {
  return num(process.env.SPX_PLAY_REENTRY_LOCK_SEC, 1200);
}

export function playGexStaleMaxSec(): number {
  return num(process.env.SPX_PLAY_GEX_STALE_MAX_SEC, 120);
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

export function playMtfBufferPts(): number {
  return num(process.env.SPX_PLAY_MTF_BUFFER_PTS, 0.25);
}

export function playStructureProximityPts(): number {
  return num(process.env.SPX_PLAY_STRUCTURE_PROX_PTS, 10);
}

export function playMinConfirmationsRequired(): number {
  return num(process.env.SPX_PLAY_MIN_CONFIRMATIONS, 7);
}

export function playTechnicalsCacheSec(): number {
  return num(process.env.SPX_PLAY_TECHNICALS_CACHE_SEC, 60);
}

export function gradeRank(grade: string): number {
  const ranks: Record<string, number> = { D: 0, C: 1, B: 2, A: 3, "A+": 4 };
  return ranks[grade.toUpperCase()] ?? 0;
}

export function playOptionChainRequired(): boolean {
  return flag(process.env.SPX_OPTION_CHAIN_REQUIRED, true);
}

export function outcomeAdaptiveMinTrades(): number {
  return num(process.env.SPX_OUTCOME_MIN_TRADES, 8);
}

export function outcomeAdaptiveMinDays(): number {
  return num(process.env.SPX_OUTCOME_MIN_DAYS, 14);
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
