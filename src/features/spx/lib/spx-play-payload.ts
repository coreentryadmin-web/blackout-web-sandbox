import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type {
  SpxConfluence,
  SpxPlayAction,
  SpxPlayDirection,
  SpxSignalFactor,
} from "@/features/spx/lib/spx-signals";
import type { PlayGateResult } from "@/features/spx/lib/spx-play-gates";
import { isBeforeCashOpen, isPremarketPlanningWindow } from "@/features/spx/lib/spx-play-session-guards";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-play-lotto";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import type { PlayConfirmationResult } from "@/features/spx/lib/spx-play-confirmations";
import type { ClaudePlayVerdict } from "@/features/spx/lib/spx-play-claude";
import { buildPlayIdeaIntel, humanizeGateBlock, humanizeGateBlocks } from "@/features/spx/lib/spx-play-intel";
import type { MtfHybrid } from "@/features/spx/lib/spx-play-mtf";
import type { loadAdaptivePlayGates } from "@/features/spx/lib/spx-play-telemetry";
import type { OptionTicket } from "@/features/spx/lib/spx-play-options";
import type { SpxPlayDeskContext } from "@/features/spx/lib/spx-play-context";

export type SpxPlayPayload = {
  available: boolean;
  phase: "SCANNING" | "WATCHING" | "OPEN";
  action: SpxPlayAction;
  direction: SpxPlayDirection | null;
  grade: string;
  score: number;
  confidence: number;
  headline: string;
  thesis: string;
  idle_message: string | null;
  factors: SpxSignalFactor[];
  levels: {
    entry: number | null;
    stop: number | null;
    target: number | null;
    invalidation: string;
  };
  gates: {
    passed: boolean;
    blocks: string[];
    warnings: string[];
    entry_mode: string;
    play_idea: string | null;
  };
  claude: ClaudePlayVerdict | null;
  open_play: {
    id: number;
    direction: SpxPlayDirection;
    entry_price: number;
    stop: number | null;
    target: number | null;
    grade: string;
    opened_at: string;
    mfe_pts: number;
    trim_done: boolean;
    option_label?: string | null;
    option_premium?: string | null;
  } | null;
  confirmations: PlayConfirmationResult | null;
  technicals: {
    m5_trend: string;
    m5_rsi: number | null;
    m5_rsi_warning: string | null;
    m3_close: number | null;
    breakout: PlayTechnicals["breakout"];
    mtf_summary: string | null;
  } | null;
  mtf: MtfHybrid | null;
  option_ticket: OptionTicket | null;
  watch: {
    active: boolean;
    promote_ready: boolean;
    reason: string;
    since: string | null;
  } | null;
  telemetry: {
    adaptive_active: boolean;
    summary: string;
    cold_buy_win_rate: number | null;
    promote_win_rate: number | null;
    global_score_boost: number;
    promote_score_boost: number;
    total_closed: number;
  } | null;
  lotto_play: LottoPlayPayload | null;
  power_play: PowerHourPlayPayload | null;
  session_phase: "premarket" | "cash" | "closed";
  /**
   * True only when the system has committed a play to the DB in this evaluation cycle.
   * False on the read-only (mutate:false) member snapshot path — even when action:"BUY"
   * is returned, the system has not yet opened the position. Members should wait for a
   * true signal_committed BUY before acting, not the snapshot signal alone.
   */
  signal_committed: boolean;
  as_of: string;
  /** Live desk/session context for hero UI — conflict gauge, session budget, structure chips. */
  desk_context?: SpxPlayDeskContext;
};

export type { SpxPlayDeskContext } from "@/features/spx/lib/spx-play-context";

export function pnlPts(direction: SpxPlayDirection, entry: number, exit: number): number {
  return direction === "long" ? exit - entry : entry - exit;
}

export function currentSessionPhase(desk: SpxDeskPayload): SpxPlayPayload["session_phase"] {
  if (isPremarketPlanningWindow() && isBeforeCashOpen()) return "premarket";
  if (desk.market_open) return "cash";
  return "closed";
}

export function telemetrySummary(
  adaptive: Awaited<ReturnType<typeof loadAdaptivePlayGates>>
): SpxPlayPayload["telemetry"] {
  const { stats } = adaptive;
  return {
    adaptive_active: adaptive.active,
    summary: adaptive.summary,
    cold_buy_win_rate: stats.cold_buy.count > 0 ? stats.cold_buy.win_rate : null,
    promote_win_rate: stats.watch_promote.count > 0 ? stats.watch_promote.win_rate : null,
    global_score_boost: adaptive.global_min_score_boost,
    promote_score_boost: adaptive.promote_min_score_boost,
    total_closed: stats.total_closed,
  };
}

export function intelGates(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  gates: PlayGateResult
): SpxPlayPayload["gates"] {
  const play_idea = gates.play_idea ?? buildPlayIdeaIntel(desk, confluence);
  return {
    passed: gates.passed,
    // Dedupe exact duplicates so the payload (and every consumer — desk panel,
    // Largo get_spx_play) never carries repeated gate lines. Display-only: the
    // pass/fail decision is computed from the raw blocks in evaluatePlayGates.
    blocks: Array.from(new Set(humanizeGateBlocks(gates.blocks, desk, confluence))),
    warnings: gates.warnings,
    entry_mode: gates.entry_mode,
    play_idea,
  };
}

/** API contract: SCANNING must not expose confirmation checks (stale-layer guard). */
export function confirmationsForAction(
  action: SpxPlayAction,
  confirmations: PlayConfirmationResult | null
): PlayConfirmationResult | null {
  return action === "SCANNING" ? null : confirmations;
}

export function scanningPayload(
  desk: SpxDeskPayload,
  confluence: SpxConfluence | null,
  idle: string,
  gates?: SpxPlayPayload["gates"],
  extras?: Partial<SpxPlayPayload>
): SpxPlayPayload {
  const playIdea =
    gates?.play_idea ??
    (confluence ? buildPlayIdeaIntel(desk, confluence) : null);
  const thesis =
    playIdea ??
    (confluence ? humanizeGateBlock(gates?.blocks[0] ?? "", desk, confluence) : null) ??
    gates?.blocks[0] ??
    "No A+ setup yet — scanning all lanes.";

  return {
    available: Boolean(desk.available && (desk.market_open || isPremarketPlanningWindow())),
    phase: "SCANNING",
    action: "SCANNING",
    direction: confluence?.direction ?? null,
    grade: confluence?.grade ?? "D",
    score: confluence?.score ?? 0,
    confidence: confluence?.confidence ?? 0,
    headline: idle,
    thesis,
    idle_message: idle,
    factors: confluence?.factors ?? [],
    levels: confluence?.levels ?? { entry: null, stop: null, target: null, invalidation: "" },
    gates: gates ?? { passed: false, blocks: [], warnings: [], entry_mode: "none", play_idea: null },
    claude: null,
    open_play: null,
    confirmations: null,
    technicals: null,
    mtf: null,
    option_ticket: null,
    watch: null,
    telemetry: null,
    lotto_play: null,
    power_play: null,
    session_phase: currentSessionPhase(desk),
    signal_committed: false,
    as_of: desk.polled_at ?? desk.as_of ?? new Date().toISOString(),
    ...extras,
  };
}

export function technicalsSummary(
  tech: PlayTechnicals | null,
  mtf: MtfHybrid | null
): SpxPlayPayload["technicals"] {
  if (!tech?.available) return null;
  return {
    m5_trend: tech.m5_trend,
    m5_rsi: tech.m5_rsi,
    m5_rsi_warning: tech.m5_rsi_warning,
    m3_close: tech.m3_close,
    breakout: tech.breakout,
    mtf_summary: mtf?.summary ?? null,
  };
}
