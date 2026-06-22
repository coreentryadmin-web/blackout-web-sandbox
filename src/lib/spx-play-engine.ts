import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { notifyPlayDiscord } from "@/lib/spx-play-notify";

function firePlayTelemetry(label: string, work: () => Promise<unknown>) {
  void work().catch((err) => {
    console.error(`[spx-play-engine] ${label}:`, err instanceof Error ? err.message : err);
  });
}
import {
  computeSpxConfluence,
  type SpxConfluence,
  type SpxPlayAction,
  type SpxPlayDirection,
  type SpxSignalFactor,
} from "@/lib/spx-signals";
import { evaluatePlayGates, GATE_BLOCK, type PlayGateResult } from "@/lib/spx-play-gates";
import { forceExitCutoffLabel, isPastForceExitCutoff, isBeforeCashOpen, isPremarketPlanningWindow } from "@/lib/spx-play-session-guards";
import type { LottoPlayPayload } from "@/lib/spx-play-lotto";
import type { PowerHourPlayPayload } from "@/lib/spx-power-hour-engine";
import { evaluatePlayConfirmations, flowAlignedForDirection } from "@/lib/spx-play-confirmations";
import { buildPlayTechnicals, type PlayTechnicals } from "@/lib/spx-play-technicals";
import type { PlayConfirmationResult } from "@/lib/spx-play-confirmations";
import { evaluateClaudePlayApproval, type ClaudePlayVerdict } from "@/lib/spx-play-claude";
import { pickIdleMessage, watchMessage } from "@/lib/spx-play-idle";
import { buildPlayIdeaIntel, humanizeGateBlock, humanizeGateBlocks } from "@/lib/spx-play-intel";
import {
  gradeRank,
  playDynamicTrailWindowPts,
  playFullMinScore,
  playIdealTargetPts,
  playOptionChainRequired,
  playTrimMfePts,
  playTrimProgressPct,
  playWatchMinScore,
  playPromoteMinScore,
  playTrailingStopBreakevenMfePts,
  playTrailingStopTrailMfePts,
  playTrailingStopTrailWindowPts,
} from "@/lib/spx-play-config";
import { evaluateThesisBreak } from "@/lib/spx-play-thesis";
import {
  closeOpenPlay,
  loadOpenPlay,
  loadPlaySessionMeta,
  openPlay,
  recordBuy,
  updateOpenPlay,
  type OpenPlayRow,
} from "@/lib/spx-play-store";
import { maybeLogSpxPlay } from "@/lib/providers/spx-signal-log";
import { evaluateMtfHybrid, keyLevelForDirection, mtfHardPass } from "@/lib/spx-play-mtf";
import type { MtfHybrid } from "@/lib/spx-play-mtf";
import {
  consumeWatchRecord,
  evaluateWatchPromote,
  clearWatchRecord,
  loadWatchRecord,
  recordWatch,
  watchSetupKey,
} from "@/lib/spx-play-watch";
import { buildOptionTicket, type OptionTicket } from "@/lib/spx-play-options";
import { recordPlayEntry } from "@/lib/spx-play-outcomes";
import type { PlayExitAction } from "@/lib/spx-play-outcomes";
import {
  effectiveFullMinScore,
  effectivePromoteMinScore,
  loadAdaptivePlayGates,
} from "@/lib/spx-play-telemetry";

export type { SpxPlayAction, SpxPlayDirection } from "@/lib/spx-signals";

export type EvaluateSpxPlayOptions = { mutate?: boolean };

/** Read-only play snapshot for member routes — no DB/Discord side effects. */
export async function getSpxPlaySnapshot(
  desk: SpxDeskPayload,
  prefetchedTechnicals?: PlayTechnicals | null
): Promise<SpxPlayPayload> {
  return evaluateSpxPlay(desk, prefetchedTechnicals, { mutate: false });
}

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
};

function pnlPts(direction: SpxPlayDirection, entry: number, exit: number): number {
  return direction === "long" ? exit - entry : entry - exit;
}

function currentSessionPhase(desk: SpxDeskPayload): SpxPlayPayload["session_phase"] {
  if (isPremarketPlanningWindow() && isBeforeCashOpen()) return "premarket";
  if (desk.market_open) return "cash";
  return "closed";
}

function telemetrySummary(adaptive: Awaited<ReturnType<typeof loadAdaptivePlayGates>>): SpxPlayPayload["telemetry"] {
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

function intelGates(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  gates: PlayGateResult
): SpxPlayPayload["gates"] {
  const play_idea = gates.play_idea ?? buildPlayIdeaIntel(desk, confluence);
  return {
    passed: gates.passed,
    blocks: humanizeGateBlocks(gates.blocks, desk, confluence),
    warnings: gates.warnings,
    entry_mode: gates.entry_mode,
    play_idea,
  };
}

function scanningPayload(
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

function technicalsSummary(
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

async function evaluateOpenPlay(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  row: OpenPlayRow,
  technicals: PlayTechnicals | null,
  confirmations: PlayConfirmationResult | null,
  mtf: MtfHybrid | null,
  telemetry: SpxPlayPayload["telemetry"],
  mutate = false
): Promise<SpxPlayPayload> {
  // Open-play path only: force-exit cutoff is independent from flat-path no-entry gates.
  const price = desk.price;
  const dir = row.direction;
  const mfe = Math.max(row.mfe_pts, dir === "long" ? price - row.entry_price : row.entry_price - price);
  const mae = Math.max(row.mae_pts, dir === "long" ? row.entry_price - price : price - row.entry_price);
  if (mutate) {
    await updateOpenPlay(row.id, { mfe_pts: mfe, mae_pts: mae });
  }

  let action: SpxPlayAction = "HOLD";
  let headline = `${row.grade} ${dir === "long" ? "CALL" : "PUT"} working`;
  let thesis = `Managing open ${dir} from ${row.entry_price.toFixed(2)} — thesis intact.`;

  const stop = row.stop;
  const target = row.target;

  const stopHit = stop != null && (dir === "long" ? price <= stop : price >= stop);
  const targetHit = target != null && (dir === "long" ? price >= target : price <= target);

  const entryScore = row.entry_score ?? confluence.score;
  const thesisEval = evaluateThesisBreak(dir, confluence.score, entryScore);
  const thesisBreak = thesisEval.broken;

  const totalRun =
    target != null ? Math.abs(target - row.entry_price) : 0;
  const progress =
    totalRun > 0
      ? dir === "long"
        ? (price - row.entry_price) / totalRun
        : (row.entry_price - price) / totalRun
      : 0;
  const trimZone =
    !row.trim_done &&
    mfe >= playTrimMfePts() &&
    target != null &&
    progress >= playTrimProgressPct();

  const forceExit = isPastForceExitCutoff();

  // Trailing stop — mfe is the rolling peak MFE (Math.max of row.mfe_pts and current move),
  // so it naturally tracks the best point the trade reached since entry.
  // Priority: breakeven lock first (at +8 pts), then price-trail (at +15 pts, 7 pts window).
  // Pairs with the trim mechanism: trim fires at MFE >=12 at 70% progress; trail protects the runner.
  const trailBreakevenMfe = playTrailingStopBreakevenMfePts();
  const trailActiveMfe = playTrailingStopTrailMfePts();
  // VIX-indexed trail window: scales with the day's range so normal retracements on
  // volatile days don't stop out a healthy runner. Falls back to the static config when
  // the env override is set (SPX_TRAILING_STOP_TRAIL_WINDOW).
  const trailWindowPts = playDynamicTrailWindowPts(desk.vix) ?? playTrailingStopTrailWindowPts();
  let trailingStop: number | null = null;
  if (mfe >= trailActiveMfe) {
    // Trail at (peak price - trailWindowPts) to lock in most of the run
    const peakPrice = dir === "long" ? row.entry_price + mfe : row.entry_price - mfe;
    trailingStop = dir === "long" ? peakPrice - trailWindowPts : peakPrice + trailWindowPts;
  } else if (mfe >= trailBreakevenMfe) {
    // Lock to entry price — worst case is a scratch, not a loss
    trailingStop = row.entry_price;
  }
  const trailingStopHit = !targetHit && trailingStop !== null && (
    dir === "long" ? price <= trailingStop : price >= trailingStop
  );

  const closeSnapshot = (exitAction: PlayExitAction, wasLoss: boolean, trimDone: boolean) => ({
    exit_price: price,
    exit_action: exitAction,
    mfe_pts: mfe,
    mae_pts: mae,
    trim_done: trimDone,
    was_loss: wasLoss,
    pnl_pts: pnlPts(dir, row.entry_price, price),
  });

  if (forceExit) {
    // C1 priority 1: force-exit (theta cutoff) — always highest priority.
    action = "SELL";
    headline = `THETA FLAT — ${forceExitCutoffLabel()} cutoff`;
    thesis = "0DTE theta window — flatten open runners before illiquid close.";
    const thetaLoss = pnlPts(dir, row.entry_price, price) < 0;
    if (mutate) {
      await closeOpenPlay(row.id, {
        was_loss: thetaLoss,
        direction: dir,
        close: closeSnapshot("THETA", thetaLoss, row.trim_done),
      });
      firePlayTelemetry("maybeLogSpxPlay:SELL", () =>
        maybeLogSpxPlay(
        { price: desk.price, market_open: desk.market_open },
        {
          action: "SELL",
          direction: dir,
          grade: row.grade,
          score: confluence.score,
          confidence: confluence.confidence,
          headline,
          thesis,
          factors: confluence.factors,
          levels: {
            entry: row.entry_price,
            stop: row.stop,
            target: row.target,
            invalidation: confluence.levels.invalidation,
          },
        }
      ));
      void notifyPlayDiscord({
        action: "SELL",
        direction: dir,
        headline,
        thesis,
        price: desk.price,
        grade: row.grade,
        score: confluence.score,
      });
    }
  } else if (targetHit) {
    // C1 priority 2: target hit — win, regardless of whether score also dropped.
    action = "SELL";
    headline = "TARGET — take profit";
    thesis = `Hit target zone ${target?.toFixed(0)} from ${row.entry_price.toFixed(2)}.`;
    if (mutate) {
      await closeOpenPlay(row.id, {
        was_loss: false,
        direction: dir,
        close: closeSnapshot("TARGET", false, row.trim_done),
      });
      firePlayTelemetry("maybeLogSpxPlay:TARGET", () =>
        maybeLogSpxPlay(
        { price: desk.price, market_open: desk.market_open },
        {
          action: "SELL",
          direction: dir,
          grade: row.grade,
          score: confluence.score,
          confidence: confluence.confidence,
          headline,
          thesis,
          factors: confluence.factors,
          levels: {
            entry: row.entry_price,
            stop: row.stop,
            target: row.target,
            invalidation: confluence.levels.invalidation,
          },
        }
      ));
      void notifyPlayDiscord({
        action: "SELL",
        direction: dir,
        headline,
        thesis,
        price: desk.price,
        grade: row.grade,
        score: confluence.score,
      });
    }
  } else if (trailingStopHit) {
    // C1 priority 2b: trailing stop hit — protected gain or scratch, NOT a loss.
    // was_loss = false so the re-entry lock and post-stop cooldown do NOT fire.
    action = "SELL";
    const trailPnl = pnlPts(dir, row.entry_price, price);
    headline = trailPnl >= 0
      ? `TRAIL STOP — +${trailPnl.toFixed(1)} pts locked`
      : "TRAIL STOP — scratch exit";
    thesis = `Trailing stop at ${trailingStop?.toFixed(2)} hit from MFE peak of +${mfe.toFixed(1)} pts.`;
    if (mutate) {
      await closeOpenPlay(row.id, {
        was_loss: false,
        direction: dir,
        close: closeSnapshot("TRAIL", false, row.trim_done),
      });
      firePlayTelemetry("maybeLogSpxPlay:TRAIL", () =>
        maybeLogSpxPlay(
          { price: desk.price, market_open: desk.market_open },
          {
            action: "SELL",
            direction: dir,
            grade: row.grade,
            score: confluence.score,
            confidence: confluence.confidence,
            headline,
            thesis,
            factors: confluence.factors,
            levels: {
              entry: row.entry_price,
              stop: trailingStop,
              target: row.target,
              invalidation: confluence.levels.invalidation,
            },
          }
        )
      );
      void notifyPlayDiscord({
        action: "SELL",
        direction: dir,
        headline,
        thesis,
        price: desk.price,
        grade: row.grade,
        score: confluence.score,
      });
    }
  } else if (stopHit || thesisBreak || !desk.market_open) {
    // C1 priority 3: stop hit, thesis break, or session close — loss.
    // C4: if market closed AND stopHit simultaneously, record was_loss=true and
    // set last_stop_at (stop takes semantic priority over session-close).
    action = "SELL";
    const sessionCloseWithStop = !desk.market_open && stopHit;
    headline = stopHit
      ? "STOP — structure broken"
      : !desk.market_open
        ? "SESSION FLAT — close 0DTE"
        : "THESIS BREAK — exit";
    thesis = stopHit
      ? `Price ${price.toFixed(2)} through stop ${stop?.toFixed(0)}. Flatten.`
      : thesisBreak
        ? `Thesis break (${thesisEval.trigger ?? "or"}) — score ${confluence.score} vs ${thesisEval.trigger === "floor" ? "±" : ""}${Math.abs(thesisEval.threshold).toFixed(0)} threshold (entry ${entryScore}).`
        : "Cash session closed — flatten runners.";
    // C4: was_loss is true for stop hits and thesis breaks regardless of market state.
    // SESSION-only closes (theta/time, no stop or thesis break) use actual PnL so a
    // losing session close correctly triggers the same-direction re-entry lock.
    const wasLoss =
      stopHit ||
      thesisBreak ||
      (!stopHit && !thesisBreak && pnlPts(dir, row.entry_price, price) < 0);
    const exitAction = stopHit ? "STOP" : !desk.market_open ? "SESSION" : "THESIS";
    if (mutate) {
      await closeOpenPlay(row.id, {
        was_loss: wasLoss,
        direction: dir,
        close: closeSnapshot(exitAction, wasLoss, row.trim_done),
      });
      firePlayTelemetry("maybeLogSpxPlay:SELL", () =>
        maybeLogSpxPlay(
        { price: desk.price, market_open: desk.market_open },
        {
          action: "SELL",
          direction: dir,
          grade: row.grade,
          score: confluence.score,
          confidence: confluence.confidence,
          headline,
          thesis,
          factors: confluence.factors,
          levels: {
            entry: row.entry_price,
            stop: row.stop,
            target: row.target,
            invalidation: confluence.levels.invalidation,
          },
        }
      ));
      void notifyPlayDiscord({
        action: "SELL",
        direction: dir,
        headline,
        thesis,
        price: desk.price,
        grade: row.grade,
        score: confluence.score,
      });
    }
  } else if (trimZone) {
    action = "TRIM";
    headline = "TRIM — bank partial, trail runner";
    thesis = `+${mfe.toFixed(1)} pts MFE · ${Math.round(progress * 100)}% to target — trim ~50%, trail runner.`;
    if (mutate) {
      await updateOpenPlay(row.id, { trim_done: true });
      firePlayTelemetry("maybeLogSpxPlay:TRIM", () =>
        maybeLogSpxPlay(
        { price: desk.price, market_open: desk.market_open },
        {
          action: "TRIM",
          direction: dir,
          grade: row.grade,
          score: confluence.score,
          confidence: confluence.confidence,
          headline,
          thesis,
          factors: confluence.factors,
          levels: {
            entry: row.entry_price,
            stop: row.stop,
            target: row.target,
            invalidation: confluence.levels.invalidation,
          },
        }
      ));
      void notifyPlayDiscord({
        action: "TRIM",
        direction: dir,
        headline,
        thesis,
        price: desk.price,
        grade: row.grade,
        score: confluence.score,
      });
    }
  }

  const optionLabel = row.option_label;
  if (optionLabel && row.option_premium) {
    thesis = `${optionLabel} @ ${row.option_premium} · ${thesis}`;
  }

  return {
    available: true,
    phase: action === "SELL" ? "SCANNING" : "OPEN",
    action,
    direction: dir,
    grade: row.grade,
    score: confluence.score,
    confidence: confluence.confidence,
    headline,
    thesis,
    idle_message: null,
    factors: confluence.factors,
    levels: {
      entry: row.entry_price,
      stop: row.stop,
      target: row.target,
      invalidation: confluence.levels.invalidation,
    },
    gates: { passed: false, blocks: [], warnings: [], entry_mode: "none", play_idea: null },
    claude: null,
    open_play:
      action === "SELL"
        ? null
        : {
            id: row.id,
            direction: dir,
            entry_price: row.entry_price,
            stop: row.stop,
            target: row.target,
            grade: row.grade,
            opened_at: row.opened_at,
            mfe_pts: mfe,
            trim_done: row.trim_done || action === "TRIM",
            option_label: row.option_label,
            option_premium: row.option_premium,
          },
    confirmations,
    technicals: technicalsSummary(technicals, mtf),
    mtf,
    option_ticket: optionLabel
      ? {
          underlying: "SPXW",
          strike: row.option_strike ?? 0,
          option_type: row.option_type === "put" ? "put" : "call",
          contract_label: optionLabel,
          ticker: null,
          bid: null,
          ask: null,
          mid: null,
          spread_pct: null,
          delta: null,
          open_interest: null,
          premium_range: row.option_premium ?? "—",
          blocked: false,
          block_reason: null,
        }
      : null,
    watch: null,
    telemetry,
    lotto_play: null,
    power_play: null,
    session_phase: "cash",
    signal_committed: true,
    as_of: confluence.as_of,
  };
}

async function evaluateFlatPlay(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  technicals: PlayTechnicals,
  confirmations: PlayConfirmationResult,
  mutate = false
): Promise<SpxPlayPayload> {
  const session = await loadPlaySessionMeta();
  const adaptive = await loadAdaptivePlayGates();
  const telemetry = telemetrySummary(adaptive);
  const baseMinScore = playFullMinScore();
  const fullMin = effectiveFullMinScore(baseMinScore, adaptive);
  const promoteMin = effectivePromoteMinScore(baseMinScore, adaptive);

  const direction = confluence.direction;
  const keyLevel =
    direction != null ? keyLevelForDirection(desk, direction, confluence) : desk.price;
  const mtf =
    direction != null
      ? evaluateMtfHybrid(direction, keyLevel, technicals, confluence.grade, confluence.score)
      : null;

  const gates = evaluatePlayGates(desk, confluence, session, confirmations, {
    min_score_boost: adaptive.global_min_score_boost,
    entry_intent: "buy",
  });
  const gatesView = intelGates(desk, confluence, gates);
  const abs = Math.abs(confluence.score);
  const techSum = technicalsSummary(technicals, mtf);

  const watchRec = await loadWatchRecord();
  if (mutate && watchRec && direction != null && watchRec.direction !== direction) {
    // Direction flipped mid-session (e.g. long watch → market turns bearish).
    // Log it so Railway/Vercel logs record the flip timestamp and the old setup key.
    console.log(
      `[spx-play-engine] direction flip: ${watchRec.direction} → ${direction}` +
      ` — clearing watch ${watchRec.setup_key ?? "(no key)"} at ${new Date().toISOString()}`
    );
    await clearWatchRecord();
  }
  const activeWatch = watchRec && direction != null && watchRec.direction === direction ? watchRec : null;
  const flowOk = direction != null ? flowAlignedForDirection(desk, direction) : false;
  const promoteEval =
    direction != null
      ? await evaluateWatchPromote({
          direction,
          price: desk.price,
          level: keyLevel,
          hybridHardOk:
            mtfHardPass(direction, keyLevel, technicals) ||
            Boolean(mtf?.ok && gradeRank(confluence.grade) >= 2),
          score: abs,
          fullMinScore: promoteMin,
          desk,
          flowOk,
        })
      : { eligible: false, reason: "No direction", record: activeWatch };

  let promoteEligible = promoteEval.eligible;
  let promoteReason = promoteEval.reason;

  if (promoteEval.eligible) {
    if (adaptive.promote_blocked) {
      promoteEligible = false;
      promoteReason = adaptive.promote_block_reason ?? "WATCH→ENTRY blocked by telemetry";
    } else if (abs < promoteMin) {
      promoteEligible = false;
      promoteReason = `WATCH→ENTRY needs score ≥${promoteMin} (telemetry +${adaptive.promote_min_score_boost})`;
    }
  }

  const watchState = {
    active: Boolean(activeWatch),
    promote_ready: promoteEligible,
    reason: gatesView.play_idea ?? promoteReason,
    since: activeWatch?.first_at ?? null,
  };

  const nearMiss =
    gradeRank(confluence.grade) >= 2 &&
    abs >= fullMin - 12 &&
    confirmations.passed_count >= confirmations.total - 3 &&
    // Guard: don't show WATCHING if any required check (3m MTF, 5m trend, S/R) is
    // still failing — the setup isn't actually close, just numerically passing on optionals.
    !confirmations.checks.some((c) => c.required && !c.passed) &&
    !gates.passed &&
    !promoteEligible;

  const watchBand =
    direction != null &&
    gradeRank(confluence.grade) >= 1 &&
    abs >= playWatchMinScore() &&
    Boolean(mtf?.ok);

  if (mutate && (nearMiss || watchBand) && direction != null && mtf) {
    await recordWatch({
      setup_key: watchSetupKey(direction),
      direction,
      level: keyLevel,
      price: desk.price,
      grade: confluence.grade,
      score: confluence.score,
      headline: `${confluence.grade} ${direction} watch @ ${keyLevel.toFixed(0)}`,
      hybrid_ok: mtf.ok,
    });
  }

  if (nearMiss && !promoteEligible) {
    const dirLabel = confluence.direction === "long" ? "bullish" : "bearish";
    return {
      ...scanningPayload(desk, confluence, watchMessage(confluence.grade, dirLabel), gatesView),
      phase: "WATCHING",
      action: "WATCHING",
      headline: `${confluence.grade} ${dirLabel} — almost there`,
      thesis:
        gatesView.play_idea ??
        gatesView.blocks[0] ??
        `High-quality setup building (${confirmations.passed_count}/${confirmations.total} checks).`,
      idle_message: null,
      claude: null,
      confirmations,
      technicals: techSum,
      mtf,
      watch: watchState,
      telemetry,
    };
  }

  let entryGatesRaw: PlayGateResult = gates;
  if (promoteEligible && direction != null) {
    const promoteBlocks = [...gates.blocks];
    if (adaptive.promote_blocked && adaptive.promote_block_reason) {
      promoteBlocks.push(adaptive.promote_block_reason);
    }
    entryGatesRaw = {
      ...gates,
      blocks: promoteBlocks.filter(
        (b) =>
          !b.includes(GATE_BLOCK.BUY_COOLDOWN) &&
          !b.includes(GATE_BLOCK.QUALITY_COOLDOWN) &&
          !b.includes(GATE_BLOCK.GRADE_BELOW_MIN) &&
          !b.includes(GATE_BLOCK.REENTRY_LOCK)
      ),
      warnings: [
        ...gates.warnings,
        ...(adaptive.promote_min_score_boost > 0
          ? [`Telemetry promote floor +${adaptive.promote_min_score_boost}`]
          : []),
      ],
    };
    if (abs >= promoteMin && entryGatesRaw.entry_mode === "full" && !adaptive.promote_blocked) {
      entryGatesRaw = { ...entryGatesRaw, passed: entryGatesRaw.blocks.length === 0 };
    } else {
      entryGatesRaw = { ...entryGatesRaw, passed: false, entry_mode: "none" };
    }
  }
  const entryGatesView = intelGates(desk, confluence, entryGatesRaw);
  const sessionExtras = { session_phase: currentSessionPhase(desk) };

  if (!entryGatesRaw.passed) {
    return {
      ...scanningPayload(desk, confluence, pickIdleMessage(), entryGatesView, sessionExtras),
      confirmations,
      technicals: techSum,
      mtf,
      watch: watchState,
      telemetry,
      phase: watchBand ? "WATCHING" : "SCANNING",
      action: watchBand ? "WATCHING" : "SCANNING",
      headline: watchBand
        ? `${confluence.grade} ${direction === "long" ? "bullish" : "bearish"} — on watch`
        : pickIdleMessage(),
      thesis:
        entryGatesView.play_idea ??
        entryGatesView.blocks[0] ??
        (watchBand
          ? `MTF ladder ${mtf?.summary ?? ""} · waiting for full gate pass.`
          : pickIdleMessage()),
    };
  }

  const claude = await evaluateClaudePlayApproval(
    desk,
    confluence,
    entryGatesRaw,
    confirmations,
    technicals,
    {
      forceClaude: promoteEligible && adaptive.promote_requires_claude,
    }
  );

  // BUG-04: detect and flag direction mismatches between Claude and confluence.
  const claudeDirectionMismatch =
    claude.direction != null &&
    confluence.direction != null &&
    claude.direction !== confluence.direction;
  if (claudeDirectionMismatch) {
    console.warn(
      `[spx-play-engine] Direction mismatch: Claude=${claude.direction} vs confluence=${confluence.direction}`
    );
  }

  if (!claude.approved || !confluence.direction) {
    return {
      ...scanningPayload(desk, confluence, pickIdleMessage(), {
        ...entryGatesView,
        passed: false,
        blocks:
          claude.verdict === "VETO"
            ? [`Claude veto: ${claude.headline}`]
            : entryGatesView.blocks,
      }, sessionExtras),
      phase: "SCANNING",
      action: "SCANNING",
      headline: claude.headline,
      thesis: claude.thesis,
      claude: { ...claude, direction_mismatch: claudeDirectionMismatch },
      confirmations,
      technicals: techSum,
      mtf,
      watch: watchState,
      telemetry,
    };
  }

  const dir = confluence.direction;
  const optionTicket = await buildOptionTicket(desk.price, dir, confluence.grade);

  if (optionTicket.blocked && playOptionChainRequired()) {
    return {
      ...scanningPayload(desk, confluence, pickIdleMessage(), {
        passed: false,
        blocks: [optionTicket.block_reason ?? "Option chain unavailable"],
        warnings: entryGatesRaw.warnings,
        entry_mode: "none",
        play_idea: entryGatesView.play_idea,
      }, sessionExtras),
      confirmations,
      technicals: techSum,
      mtf,
      option_ticket: optionTicket,
      watch: watchState,
      telemetry,
    };
  }

  const existingBeforeOpen = await loadOpenPlay();
  if (existingBeforeOpen) {
    return evaluateOpenPlay(
      desk,
      confluence,
      existingBeforeOpen,
      technicals,
      confirmations,
      mtf,
      telemetry,
      mutate
    );
  }

  const sessionDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());

  const entryPath = promoteEligible ? "watch_promote" : "cold_buy";
  const promotePrefix = promoteEligible ? "WATCH→ENTRY · " : "";
  const contractHeadline = optionTicket.contract_label
    ? `${promotePrefix}Buy ${optionTicket.contract_label} @ ${optionTicket.premium_range}`
    : `${promotePrefix}${claude.headline}`;

  if (!mutate) {
    // Read-only snapshot: all gates passed and Claude approved, but mutate:false so no
    // play was opened. Surface action:"BUY" so member-facing UIs know a live entry would
    // fire right now rather than showing a misleading SCANNING/WATCHING phase.
    return {
      available: true,
      phase: "SCANNING",
      action: "BUY",
      direction: dir,
      grade: confluence.grade,
      score: confluence.score,
      confidence: confluence.confidence,
      headline: contractHeadline,
      thesis: entryGatesView.play_idea ?? claude.thesis,
      idle_message: null,
      factors: confluence.factors,
      levels: confluence.levels,
      gates: entryGatesView,
      claude: { ...claude, direction_mismatch: claudeDirectionMismatch },
      open_play: null,
      confirmations,
      technicals: techSum,
      mtf,
      option_ticket: optionTicket,
      watch: watchState,
      telemetry,
      lotto_play: null,
      power_play: null,
      session_phase: currentSessionPhase(desk),
      signal_committed: false,
      as_of: confluence.as_of,
    };
  }

  const openedAt = new Date().toISOString();
  const { row: opened, created } = await openPlay({
    session_date: sessionDate,
    direction: dir,
    entry_price: desk.price,
    entry_score: confluence.score,
    stop: confluence.levels.stop,
    target: confluence.levels.target,
    grade: confluence.grade,
    headline: contractHeadline,
    opened_at: openedAt,
    option_strike: optionTicket.strike,
    option_type: optionTicket.option_type,
    option_label: optionTicket.contract_label,
    option_premium: optionTicket.premium_range,
  });

  if (!created) {
    const existing = await loadOpenPlay();
    if (existing) {
      return evaluateOpenPlay(
        desk,
        confluence,
        existing,
        technicals,
        confirmations,
        mtf,
        telemetry,
        mutate
      );
    }
    // Race: concurrent request created the play between our pre-checks and openPlay()
    // returning created:false, but the play has already been cleaned up or the DB row
    // disappeared. Bail without firing Discord/telemetry to avoid duplicate side effects.
    return {
      ...scanningPayload(desk, confluence, pickIdleMessage(), entryGatesView, sessionExtras),
      confirmations,
      technicals: techSum,
      mtf,
      watch: watchState,
      telemetry,
    };
  }

  if (mutate) {
    await recordBuy(dir);
    if (promoteEligible) await consumeWatchRecord();
  }

  if (mutate) {
    try {
      await recordPlayEntry({
        open_play_id: opened.id,
        session_date: sessionDate,
        direction: dir,
        entry_path: entryPath,
        grade: confluence.grade,
        score: confluence.score,
        confidence: confluence.confidence,
        entry_price: desk.price,
        stop: confluence.levels.stop,
        target: confluence.levels.target,
        headline: contractHeadline,
        factors: confluence.factors,
        confirmations,
        mtf,
        claude,
        option_ticket: optionTicket,
        opened_at: openedAt,
      });
    } catch (err) {
      console.error(
        "[spx-play-engine] recordPlayEntry:",
        err instanceof Error ? err.message : err
      );
    }

    void notifyPlayDiscord({
      action: "BUY",
      direction: dir,
      headline: contractHeadline,
      thesis: claude.thesis,
      price: desk.price,
      grade: confluence.grade,
      score: confluence.score,
    });

    firePlayTelemetry("maybeLogSpxPlay:BUY", () =>
      maybeLogSpxPlay(
      { price: desk.price, market_open: desk.market_open },
      {
        action: "BUY",
        direction: dir,
        grade: confluence.grade,
        score: confluence.score,
        confidence: confluence.confidence,
        headline: contractHeadline,
        thesis: `${optionTicket.contract_label} ${optionTicket.premium_range} · ${claude.thesis}`,
        factors: confluence.factors,
        levels: confluence.levels,
      }
    ));
  }

  return {
    available: true,
    phase: "OPEN",
    action: "BUY",
    direction: dir,
    grade: confluence.grade,
    score: confluence.score,
    confidence: confluence.confidence,
    headline: contractHeadline,
    thesis: `${claude.thesis}${optionTicket.delta != null ? ` · Δ ${optionTicket.delta.toFixed(2)}` : ""}`,
    idle_message: null,
    factors: confluence.factors,
    levels: confluence.levels,
    gates: {
      passed: true,
      blocks: [],
      warnings: entryGatesRaw.warnings,
      entry_mode: entryGatesRaw.entry_mode,
      play_idea: entryGatesView.play_idea,
    },
    claude: { ...claude, direction_mismatch: claudeDirectionMismatch },
    open_play: {
      id: opened.id,
      direction: dir,
      entry_price: opened.entry_price,
      stop: opened.stop,
      target: opened.target,
      grade: opened.grade,
      opened_at: opened.opened_at,
      mfe_pts: 0,
      trim_done: false,
      option_label: optionTicket.contract_label,
      option_premium: optionTicket.premium_range,
    },
    confirmations,
    technicals: techSum,
    mtf,
    option_ticket: optionTicket,
    watch: { active: false, promote_ready: false, reason: "Entered", since: null },
    telemetry,
    lotto_play: null,
    power_play: null,
    session_phase: currentSessionPhase(desk),
    signal_committed: true,
    as_of: confluence.as_of,
  };
}

export async function evaluateSpxPlay(
  desk: SpxDeskPayload,
  prefetchedTechnicals?: PlayTechnicals | null,
  options?: { mutate?: boolean }
): Promise<SpxPlayPayload> {
  const mutate = options?.mutate === true;
  const premarket = isPremarketPlanningWindow();
  if (!desk.market_open && !premarket) {
    const closedConfluence = desk.price > 0 ? computeSpxConfluence(desk) : null;
    const playIdea =
      closedConfluence != null ? buildPlayIdeaIntel(desk, closedConfluence) : null;
    const dir = closedConfluence?.direction;
    const entry = desk.price > 0 ? desk.price : null;
    const idealTarget =
      entry != null && dir != null
        ? dir === "long"
          ? entry + playIdealTargetPts()
          : entry - playIdealTargetPts()
        : null;

    return {
      available: false,
      phase: "SCANNING",
      action: "SCANNING",
      direction: dir ?? null,
      grade: closedConfluence?.grade ?? "D",
      score: closedConfluence?.score ?? 0,
      confidence: closedConfluence?.confidence ?? 0,
      headline: "Session closed",
      thesis: `Desk offline · ${desk.market_label ?? "CLOSED"} · resumes 6:30 AM PT`,
      idle_message: null,
      factors: closedConfluence?.factors ?? [],
      levels: {
        entry,
        stop: closedConfluence?.levels.stop ?? null,
        target: idealTarget,
        invalidation: closedConfluence?.levels.invalidation ?? "",
      },
      gates: {
        passed: false,
        blocks: ["Session closed"],
        warnings: [],
        entry_mode: "none",
        play_idea: playIdea,
      },
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
      session_phase: "closed",
      signal_committed: false,
      as_of: desk.polled_at ?? desk.as_of ?? new Date().toISOString(),
    };
  }

  const technicals =
    prefetchedTechnicals ??
    (await buildPlayTechnicals(desk.price, {
      vwap: desk.vwap,
      pdh: desk.pdh,
      pdl: desk.pdl,
      hod: desk.hod,
      lod: desk.lod,
    }));

  const confluence = computeSpxConfluence(desk);
  if (!confluence) {
    return scanningPayload(desk, null, pickIdleMessage());
  }

  const confirmations = evaluatePlayConfirmations(desk, confluence, technicals);
  const direction = confluence.direction;
  const keyLevel =
    direction != null ? keyLevelForDirection(desk, direction, confluence) : desk.price;
  const mtf =
    direction != null
      ? evaluateMtfHybrid(direction, keyLevel, technicals, confluence.grade, confluence.score)
      : null;

  const adaptive = await loadAdaptivePlayGates();
  const telemetry = telemetrySummary(adaptive);

  const open = await loadOpenPlay();
  if (open) {
    return evaluateOpenPlay(desk, confluence, open, technicals, confirmations, mtf, telemetry, mutate);
  }

  return evaluateFlatPlay(desk, confluence, technicals, confirmations, mutate);
}
