/** Play engine thresholds — aligned with Discord SPX desk defaults. */

function num(env: string | undefined, fallback: number): number {
  const n = Number(env?.trim());
  return Number.isFinite(n) ? n : fallback;
}

export function playStarterMinScore(): number {
  return num(process.env.SPX_PLAY_STARTER_MIN_SCORE, 52);
}

export function playFullMinScore(): number {
  return num(process.env.SPX_PLAY_FULL_MIN_SCORE, 62);
}

export function playWatchMinScore(): number {
  return num(process.env.SPX_PLAY_WATCH_MIN_SCORE, 35);
}

export function playConflictBlockMin(): number {
  return num(process.env.SPX_PLAY_CONFLICT_BLOCK_MIN, 3);
}

export function playBuyCooldownSec(): number {
  return num(process.env.SPX_PLAY_BUY_COOLDOWN_SEC, 180);
}

export function playReentryLockSec(): number {
  return num(process.env.SPX_PLAY_REENTRY_LOCK_SEC, 900);
}

export function playGexStaleMaxSec(): number {
  return num(process.env.SPX_PLAY_GEX_STALE_MAX_SEC, 240);
}

export function playClaudeGateEnabled(): boolean {
  const raw = process.env.SPX_CLAUDE_GATE?.trim().toLowerCase();
  if (raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function playClaudeCacheSec(): number {
  return num(process.env.SPX_CLAUDE_PLAY_CACHE_SEC, 45);
}

export function playTrimMfePts(): number {
  return num(process.env.SPX_PLAY_TRIM_MFE_PTS, 12);
}

export function playThesisBreakScore(): number {
  return num(process.env.SPX_PLAY_THESIS_BREAK_SCORE, 40);
}
