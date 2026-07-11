import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { todayEt } from "@/lib/et-date";
import { notifyPlayDiscord } from "@/features/spx/lib/spx-play-notify";
import { dbConfigured, fetchLatestNighthawkEdition } from "@/lib/db";

function firePlayTelemetry(label: string, work: () => Promise<unknown>) {
  void work().catch((err) => {
    console.error(`[spx-play-engine] ${label}:`, err instanceof Error ? err.message : err);
  });
}

function spxPlayDebug(...args: unknown[]) {
  if (process.env.SPX_PLAY_DEBUG === "1") console.log(...args);
}
import {
  computeSpxConfluence,
  type SpxConfluence,
  type SpxPlayAction,
  type SpxPlayDirection,
  type SpxSignalFactor,
} from "@/features/spx/lib/spx-signals";
import { evaluatePlayGates, GATE_BLOCK, type PlayGateResult } from "@/features/spx/lib/spx-play-gates";
import {
  categorizeGateBlocks,
  emptyCategorizedGateBlocks,
  firstGateBlockCategory,
} from "@/features/spx/lib/playbook-gate-categories";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import { forceExitCutoffLabel, isPastForceExitCutoff, isBeforeCashOpen, isPremarketPlanningWindow } from "@/features/spx/lib/spx-play-session-guards";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-play-lotto";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import { evaluatePlayConfirmations, flowAlignedForDirection } from "@/features/spx/lib/spx-play-confirmations";
import { buildPlayTechnicals, type PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import type { PlayConfirmationResult } from "@/features/spx/lib/spx-play-confirmations";
import { evaluateClaudePlayApproval, type ClaudePlayVerdict } from "@/features/spx/lib/spx-play-claude";
import { pickIdleMessage, watchMessage } from "@/features/spx/lib/spx-play-idle";
import { buildPlayIdeaIntel, humanizeGateBlock, humanizeGateBlocks } from "@/features/spx/lib/spx-play-intel";
import { playbookExitProfile } from "@/features/spx/lib/playbook-verdict-guard";
import {
  gradeRank,
  playDynamicTrailWindowPts,
  playDynamicTrimMfePts,
  playFullMinScore,
  playIdealTargetPts,
  playOptionChainRequired,
  playGexStaleMaxSec,
  playThesisBreakDropPts,
  playThesisBreakScore,
  playTrimProgressPct,
  playWatchMinScore,
  playPromoteMinScore,
  playTrailingStopBreakevenMfePts,
  playTrailingStopTrailMfePts,
  playTrailingStopTrailWindowPts,
  playBuyCooldownAplusBypass,
  playbookStagingLabEnabled,
} from "@/features/spx/lib/spx-play-config";
import { evaluateOpenThesisBreak } from "@/features/spx/lib/spx-play-thesis";
import { enrichPlayPayload } from "@/features/spx/lib/spx-play-context";
import { deskAgeSec, isDeskStale } from "@/features/spx/lib/spx-desk-stale";
import {
  closeOpenPlay,
  loadOpenPlay,
  loadPlaySessionMeta,
  openPlay,
  recordBuy,
  updateOpenPlay,
  type OpenPlayRow,
} from "@/features/spx/lib/spx-play-store";
import {
  maybeLogSpxPlay,
  logSpxShadowFactors,
  logSpxMacroPredictionsShadowFactor,
  logSpxSkewShadowFactors,
  logSpxEcosystemShadowFactors,
  logMegaCapCatalystShadowFactors,
  logSpxPrecedentsShadowFactor,
  maybeLogSpxEngineSnapshot,
} from "@/features/spx/lib/spx-signal-log";
import { evaluateMtfHybrid, keyLevelForDirection, mtfHardPass } from "@/features/spx/lib/spx-play-mtf";
import type { MtfHybrid } from "@/features/spx/lib/spx-play-mtf";
import {
  consumeWatchRecord,
  evaluateWatchPromote,
  clearWatchRecord,
  loadWatchRecord,
  recordWatch,
  watchSetupKey,
} from "@/features/spx/lib/spx-play-watch";
import { buildOptionTicket, quoteSpxOdteContract, type OptionTicket } from "@/features/spx/lib/spx-play-options";
import { buildOptionExecutionSim } from "@/features/spx/lib/playbook-option-sim";
import {
  buildGreeksSnapshot,
  estimateOptionPnl,
  parseOptionPremiumMid,
} from "@/features/spx/lib/playbook-option-pnl";
import { mergeTradeGovernorWithOptionOverlay } from "@/features/spx/lib/trade-governor";
import {
  evaluatePlaybookExitPlan,
  strongestPlaybookExitSignal,
} from "@/features/spx/lib/playbook-exit-engines";
import { buildVolatilityContext } from "@/features/spx/lib/playbook-volatility-context";
import {
  commitPlaybookInstanceCancelled,
  commitPlaybookInstanceClosed,
  commitPlaybookInstanceEntryPending,
  commitPlaybookInstanceExitPending,
  commitPlaybookInstanceManaging,
  commitPlaybookInstanceOpen,
  resolveActivePlaybookInstanceId,
} from "@/features/spx/lib/playbook-fsm-sync";
import { resolveGuardedPlaybookMatch } from "@/features/spx/lib/playbook-match-resolver";
import { refreshOrBreakMemory } from "@/features/spx/lib/playbook-break-memory-store";
import type { OrBreakMemory } from "@/features/spx/lib/playbook-break-memory";
import type { ResolvedPlaybookMatch } from "@/features/spx/lib/playbook-match-resolver";
import { parseSpxContractLabel } from "@/features/spx/lib/spx-play-contract-label";
import type { PlayExitAction } from "@/features/spx/lib/spx-play-outcomes";
import {
  effectiveFullMinScore,
  effectivePromoteMinScore,
  loadAdaptivePlayGates,
} from "@/features/spx/lib/spx-play-telemetry";

export type { SpxPlayAction, SpxPlayDirection } from "@/features/spx/lib/spx-signals";
// Payload type + leaf snapshot/payload builders live in spx-play-payload.ts (pure helpers,
// no engine import — no cycle). Re-export SpxPlayPayload so external consumers keep importing
// it from "@/features/spx/lib/spx-play-engine" unchanged.
export type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import {
  pnlPts,
  currentSessionPhase,
  telemetrySummary,
  intelGates,
  confirmationsForAction,
  scanningPayload,
  technicalsSummary,
} from "@/features/spx/lib/spx-play-payload";

export type EvaluateSpxPlayOptions = {
  mutate?: boolean;
  /** Shared OR memory from caller — avoids split-brain vs playbook panel on member reads. */
  or_break_memory?: OrBreakMemory | null;
  /** Pre-resolved playbook match — skips redundant resolver when set. */
  playbook_resolved?: ResolvedPlaybookMatch | null;
};

/**
 * Read the most recent Night Hawk edition and extract a signed confluence bonus
 * for the SPX morning direction. The NH edition is an evening signal; it provides
 * a prior for the next-day open before the desk has enough RTH flow to self-resolve.
 *
 * Returns: +3 for bullish NH bias with 3+ A-grade longs, −3 for bearish bias, 0 otherwise.
 * Always resolves (catches all errors) — the SPX engine must not fail due to a missing edition.
 */
async function getNhConfluenceBonus(): Promise<{ bonus: number; label: string } | null> {
  if (!dbConfigured()) return null;
  try {
    const edition = await fetchLatestNighthawkEdition();
    if (!edition) return null;

    // Require the edition to be from today or yesterday (not stale).
    const publishedAt = new Date(edition.published_at);
    const ageHours = (Date.now() - publishedAt.getTime()) / 3_600_000;
    if (ageHours > 20) return null; // Edition older than 20h — too stale to use as a morning prior.

    const plays = Array.isArray(edition.plays) ? edition.plays : [];
    // Infer market_bias from the market_recap field or from plays.
    const recap = edition.market_recap as Record<string, unknown> | null | undefined;
    const explicitBias = recap?.market_bias ?? recap?.bias;
    const recapBias =
      typeof explicitBias === "string" ? explicitBias.toLowerCase() : null;

    // Count A-grade directional plays.
    let aGradeLongs = 0;
    let aGradeShorts = 0;
    for (const p of plays) {
      const play = p as Record<string, unknown>;
      const conviction = String(play.conviction ?? play.grade ?? "").toUpperCase();
      const direction = String(play.direction ?? "").toLowerCase();
      if (conviction === "A+" || conviction === "A") {
        if (direction === "long" || direction === "bullish") aGradeLongs++;
        else if (direction === "short" || direction === "bearish") aGradeShorts++;
      }
    }

    // Bullish prior: explicit bullish bias OR 3+ A-grade longs with more longs than shorts.
    if ((recapBias === "bullish" || aGradeLongs >= 3) && aGradeLongs > aGradeShorts) {
      return { bonus: 3, label: `NH bias bullish (${aGradeLongs} A-grade longs)` };
    }
    // Bearish prior: explicit bearish bias OR 3+ A-grade shorts with more shorts than longs.
    if ((recapBias === "bearish" || aGradeShorts >= 3) && aGradeShorts > aGradeLongs) {
      return { bonus: -3, label: `NH bias bearish (${aGradeShorts} A-grade shorts)` };
    }
    return null;
  } catch {
    return null;
  }
}

/** Read-only play snapshot for member routes — no DB/Discord side effects. */
export async function getSpxPlaySnapshot(
  desk: SpxDeskPayload,
  prefetchedTechnicals?: PlayTechnicals | null
): Promise<SpxPlayPayload> {
  return evaluateSpxPlay(desk, prefetchedTechnicals, { mutate: false });
}

// SpxPlayPayload type and the leaf builders (pnlPts, currentSessionPhase, telemetrySummary,
// intelGates, scanningPayload, technicalsSummary) were moved to spx-play-payload.ts and are
// imported above. Behavior is unchanged — this is a pure move.

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
  // Staleness guard (mirrors the flat-entry guard in spx-play-gates.ts): if the desk
  // snapshot is older than the configured GEX-stale window, desk.price is untrustworthy.
  // We must NOT fire price-driven exits (stop/target/trail/trim) off a stale quote, and
  // we must not record MFE/MAE excursion peaks from a stale price. Time-based exits
  // (theta force-exit, session close) are independent of price and stay live below.
  const deskStale = isDeskStale(deskAgeSec(desk.polled_at, desk.as_of), playGexStaleMaxSec());
  const mfe = Math.max(row.mfe_pts, dir === "long" ? price - row.entry_price : row.entry_price - price);
  const mae = Math.max(row.mae_pts, dir === "long" ? row.entry_price - price : price - row.entry_price);
  if (mutate && !deskStale) {
    await updateOpenPlay(row.id, { mfe_pts: mfe, mae_pts: mae });
  }

  let action: SpxPlayAction = "HOLD";
  let headline = `${row.grade} ${dir === "long" ? "CALL" : "PUT"} working`;
  let thesis = `Managing open ${dir} from ${row.entry_price.toFixed(2)} — thesis intact.`;

  const sessionDateFsm = todayEt();
  const entryScore = row.entry_score ?? confluence.score;
  const forceExit = isPastForceExitCutoff();
  const volCtx = buildVolatilityContext(desk, technicals);

  const pbId = (row.playbook_id as PlaybookId | null | undefined) ?? null;
  const exitPlan = pbId
    ? evaluatePlaybookExitPlan({
        playbook_id: pbId,
        desk,
        technicals,
        row,
        direction: dir,
        price,
        confluence_score: confluence.score,
        entry_score: entryScore,
        mfe_pts: mfe,
        vol_ctx: volCtx,
        desk_stale: deskStale,
        force_exit: forceExit,
      })
    : null;

  const pbExitSignal = exitPlan ? strongestPlaybookExitSignal(exitPlan) : null;

  const stop = row.stop;
  const target = row.target;

  let stopHit = !deskStale && stop != null && (dir === "long" ? price <= stop : price >= stop);
  let targetHit = !deskStale && target != null && (dir === "long" ? price >= target : price <= target);
  let thesisBreak = exitPlan?.thesis_break ?? false;
  let trimZone = exitPlan?.trim_zone ?? false;
  let trailingStop = exitPlan?.trailing_stop ?? null;
  let trailingStopHit =
    !deskStale &&
    trailingStop !== null &&
    (dir === "long" ? price <= trailingStop : price >= trailingStop);

  if (!pbId) {
    const exitProf = playbookExitProfile(pbId);
    const thesisEval = evaluateOpenThesisBreak(dir, confluence.score, entryScore, {
      mfePts: mfe,
      openedAtMs: new Date(row.opened_at).getTime(),
    }, {
      dropPts: playThesisBreakDropPts() * exitProf.thesis_break_mult,
      floor: playThesisBreakScore() * exitProf.thesis_break_mult,
    });
    thesisBreak = thesisEval.broken;
    const totalRun = target != null ? Math.abs(target - row.entry_price) : 0;
    const progress =
      totalRun > 0
        ? dir === "long"
          ? (price - row.entry_price) / totalRun
          : (row.entry_price - price) / totalRun
        : 0;
    trimZone =
      !deskStale &&
      !row.trim_done &&
      mfe >= playDynamicTrimMfePts(desk.vix) * exitProf.trim_mfe_mult &&
      target != null &&
      progress >= playTrimProgressPct();
    const trailWindowPts =
      (playDynamicTrailWindowPts(desk.vix) ?? playTrailingStopTrailWindowPts()) *
      exitProf.trail_window_mult;
    trailingStop = null;
    if (mfe >= playTrailingStopTrailMfePts()) {
      const peakPrice = dir === "long" ? row.entry_price + mfe : row.entry_price - mfe;
      trailingStop = dir === "long" ? peakPrice - trailWindowPts : peakPrice + trailWindowPts;
    } else if (mfe >= playTrailingStopBreakevenMfePts()) {
      trailingStop = row.entry_price;
    }
    trailingStopHit =
      !deskStale && !targetHit && trailingStop !== null &&
      (dir === "long" ? price <= trailingStop : price >= trailingStop);
  } else if (pbExitSignal?.action === "SELL" && pbExitSignal.priority >= 85) {
    stopHit = pbExitSignal.reason.includes("Stop");
    targetHit = pbExitSignal.reason.includes("Target");
    thesisBreak = pbExitSignal.reason.includes("Thesis") || pbExitSignal.reason.includes("VWAP");
  }

  const totalRun = target != null ? Math.abs(target - row.entry_price) : 0;
  const progress =
    totalRun > 0
      ? dir === "long"
        ? (price - row.entry_price) / totalRun
        : (row.entry_price - price) / totalRun
      : 0;

  const fsmOnClose = async (
    exitReason: string,
    exitAction: string,
    setupInvalidated = false
  ) => {
    if (!mutate || !pbId) return;
    if (setupInvalidated) {
      await commitPlaybookInstanceExitPending({
        session_date: sessionDateFsm,
        playbook_id: pbId,
        direction: dir,
        desk,
        technicals,
        reason: exitReason,
      });
    }
    await commitPlaybookInstanceClosed({
      session_date: sessionDateFsm,
      playbook_id: pbId,
      direction: dir,
      desk,
      technicals,
      exit_reason: exitReason,
      exit_action: exitAction,
    });
  };

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
      await fsmOnClose("theta cutoff", "THETA");
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
      await fsmOnClose("target hit", "TARGET");
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
      await fsmOnClose("trailing stop", "TRAIL");
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
        ? pbExitSignal?.reason ?? `Thesis break — score ${confluence.score} vs entry ${entryScore}.`
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
      await fsmOnClose(headline, exitAction, thesisBreak);
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
  } else if (
    pbExitSignal?.action === "SELL" &&
    pbExitSignal.priority >= 82 &&
    !targetHit &&
    !stopHit &&
    !trailingStopHit
  ) {
    action = "SELL";
    headline = pbExitSignal.reason;
    thesis = pbExitSignal.reason;
    const wasLoss = pnlPts(dir, row.entry_price, price) < 0;
    if (mutate) {
      await closeOpenPlay(row.id, {
        was_loss: wasLoss,
        direction: dir,
        close: closeSnapshot("THESIS", wasLoss, row.trim_done),
      });
      await fsmOnClose(pbExitSignal.reason, "THESIS", true);
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
  } else if (trimZone) {
    action = "TRIM";
    headline = "TRIM — bank partial, trail runner";
    thesis = `+${mfe.toFixed(1)} pts MFE · ${Math.round(progress * 100)}% to target — trim ~50%, trail runner.`;
    if (mutate) {
      await updateOpenPlay(row.id, { trim_done: true });
      if (pbId) {
        await commitPlaybookInstanceManaging({
          session_date: sessionDateFsm,
          playbook_id: pbId,
          direction: dir,
          desk,
          technicals,
          detail: headline,
        });
      }
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
  let optionPremium = row.option_premium;
  let liveTicket: OptionTicket | null = null;

  if (action !== "SELL" && optionLabel) {
    const parsed = parseSpxContractLabel(optionLabel);
    const strike = row.option_strike ?? parsed?.strike;
    const optType: "call" | "put" =
      row.option_type === "put"
        ? "put"
        : row.option_type === "call"
          ? "call"
          : dir === "short"
            ? "put"
            : "call";
    if (strike) {
      try {
        const q = await quoteSpxOdteContract(strike, optType);
        if (q) {
          optionPremium = q.premium_display;
          liveTicket = {
            underlying: "SPXW",
            strike: q.strike,
            option_type: q.option_type,
            contract_label: optionLabel,
            ticker: null,
            bid: q.bid,
            ask: q.ask,
            mid: q.mid,
            spread_pct: q.spread_pct,
            delta: q.delta,
            open_interest: null,
            premium_range: q.premium_display,
            blocked: false,
            block_reason: null,
          };
        }
      } catch {
        /* chain quote is best-effort — fall back to stored premium */
      }
    }
  }

  if (optionLabel && optionPremium) {
    thesis = `${optionLabel} @ ${optionPremium} · ${thesis}`;
  }

  const storedTicket: OptionTicket | null = optionLabel
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
        premium_range: optionPremium ?? row.option_premium ?? "—",
        blocked: false,
        block_reason: null,
      }
    : null;

  let optionPnlEst = null;
  const entryPremiumMid =
    parseOptionPremiumMid(row.option_premium) ?? liveTicket?.mid ?? storedTicket?.mid ?? null;
  if (entryPremiumMid != null) {
    const minutesHeld = Math.max(
      0,
      (Date.now() - new Date(row.opened_at).getTime()) / 60_000
    );
    const greeks = buildGreeksSnapshot({
      direction: dir,
      entry_spot: row.entry_price,
      option_mid: entryPremiumMid,
      delta: liveTicket?.delta ?? storedTicket?.delta ?? null,
    });
    optionPnlEst = estimateOptionPnl({
      greeks,
      current_spot: price,
      minutes_held: minutesHeld,
      round_trip_cost_pts:
        liveTicket?.spread_pct != null
          ? (liveTicket.spread_pct / 100) * entryPremiumMid
          : null,
    });
    if (action === "HOLD") {
      thesis = `${thesis} · est Δ$${optionPnlEst.net_premium_pnl.toFixed(2)}`;
    }
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
    gates: {
      passed: false,
      blocks: [],
      blocks_by_category: emptyCategorizedGateBlocks(),
      first_block_category: null,
      warnings: [],
      entry_mode: "none",
      play_idea: null,
    },
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
            option_premium: optionPremium ?? row.option_premium,
            option_pnl_est: optionPnlEst,
          },
    confirmations,
    technicals: technicalsSummary(technicals, mtf),
    mtf,
    option_ticket: liveTicket ?? storedTicket,
    watch: null,
    telemetry,
    lotto_play: null,
    power_play: null,
    session_phase: "cash",
    // Every DB write in this function (updateOpenPlay/closeOpenPlay above) is
    // already gated on `mutate` — this must match, or a mutate:false read (the
    // member-facing 3s poll) can render a full "SELL — TARGET"/"STOP" card that
    // claims to be committed when nothing was actually closed. See FINDINGS.md.
    signal_committed: mutate,
    as_of: confluence.as_of,
  };
}

async function evaluateFlatPlay(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  technicals: PlayTechnicals,
  confirmations: PlayConfirmationResult,
  mutate = false,
  playbookOpts?: Pick<EvaluateSpxPlayOptions, "or_break_memory" | "playbook_resolved">
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

  const sessionDate = todayEt();
  const orBreakMemory =
    playbookOpts?.or_break_memory != null
      ? playbookOpts.or_break_memory
      : await refreshOrBreakMemory(sessionDate, desk, technicals, mutate);

  const playbookResolved =
    playbookOpts?.playbook_resolved ??
    (await resolveGuardedPlaybookMatch(sessionDate, desk, technicals, {
      or_break_memory: orBreakMemory,
    }));
  const playbookMatch = playbookResolved;
  const playbookPrimaryId: PlaybookId | null = playbookMatch.primary_playbook_id;
  const primaryVerdict = playbookPrimaryId
    ? playbookMatch.verdicts.find((v) => v.playbook_id === playbookPrimaryId)
    : null;
  const playbookPrimaryDirection = primaryVerdict?.direction ?? null;
  const playbookLabActive =
    playbookStagingLabEnabled() &&
    playbookPrimaryId != null &&
    playbookPrimaryDirection != null &&
    direction === playbookPrimaryDirection;
  const gatePlaybookOpts = {
    playbook_primary_id: playbookPrimaryId,
    playbook_primary_direction: playbookPrimaryDirection,
    triggers_today_by_pb: playbookResolved.triggers_today_by_pb,
  };

  const gatesWatch = evaluatePlayGates(desk, confluence, session, confirmations, {
    min_score_boost: adaptive.global_min_score_boost,
    entry_intent: "watch",
    ...gatePlaybookOpts,
  });
  const gatesView = intelGates(desk, confluence, gatesWatch);
  const abs = Math.abs(confluence.score);
  const techSum = technicalsSummary(technicals, mtf);

  const watchRec = await loadWatchRecord();
  if (mutate && watchRec && direction != null && watchRec.direction !== direction) {
    // Direction flipped mid-session (e.g. long watch → market turns bearish).
    // Log it so Railway/Vercel logs record the flip timestamp and the old setup key.
    spxPlayDebug(
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
          // WATCH→ENTRY promote requires hard MTF only — no soft 3m/5m bypass (see mtfHardPass).
          hybridHardOk: mtfHardPass(direction, keyLevel, technicals),
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

  const buyCooldownBypass =
    promoteEligible ||
    (playBuyCooldownAplusBypass() && gradeRank(confluence.grade) >= gradeRank("A+"));

  const gatesBuy = evaluatePlayGates(desk, confluence, session, confirmations, {
    min_score_boost: adaptive.global_min_score_boost,
    entry_intent: "buy",
    cold_buy_path: !promoteEligible && !playbookLabActive,
    bypass_buy_cooldown: buyCooldownBypass,
    ...gatePlaybookOpts,
  });

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
    !gatesBuy.passed &&
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

  let entryGatesRaw: PlayGateResult = gatesBuy;
  if (promoteEligible && direction != null) {
    const promoteBlocks = [...gatesBuy.blocks];
    if (adaptive.promote_blocked && adaptive.promote_block_reason) {
      promoteBlocks.push(adaptive.promote_block_reason);
    }
    entryGatesRaw = {
      ...gatesBuy,
      blocks: promoteBlocks.filter(
        (b) =>
          !b.includes(GATE_BLOCK.BUY_COOLDOWN) &&
          !b.includes(GATE_BLOCK.QUALITY_COOLDOWN) &&
          !b.includes(GATE_BLOCK.GRADE_BELOW_MIN) &&
          !(
            b.includes(GATE_BLOCK.MIXED_TAPE) &&
            confirmations.passed &&
            gradeRank(confluence.grade) >= gradeRank("A")
          ) &&
          // Post-loss same-direction re-entry lock must survive WATCH->ENTRY promotion.
          // Only strip REENTRY_LOCK when the prior exit was NOT a loss (in which case
          // the gate never emits it anyway, so this is a no-op outside the loss case).
          (session.last_sell_was_loss
            ? true
            : !b.includes(GATE_BLOCK.REENTRY_LOCK))
      ),
      warnings: [
        ...gatesBuy.warnings,
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
    spxPlayDebug('[spx-play-engine] entry gates blocked:', {
      grade: confluence.grade,
      score: confluence.score,
      direction: confluence.direction,
      blocks: entryGatesRaw.blocks,
      entry_mode: entryGatesRaw.entry_mode,
      mutate,
      flow_data_age_ms: desk.flow_data_age_ms,
      gex_walls_count: desk.gex_walls?.length ?? 0,
    });
    const idleAction = watchBand ? "WATCHING" : "SCANNING";
    return {
      ...scanningPayload(desk, confluence, pickIdleMessage(), entryGatesView, sessionExtras),
      confirmations: confirmationsForAction(idleAction, confirmations),
      technicals: techSum,
      mtf,
      watch: watchState,
      telemetry,
      phase: idleAction,
      action: idleAction,
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
    spxPlayDebug('[spx-play-engine] Claude blocked play:', {
      verdict: claude.verdict,
      source: claude.source,
      approved: claude.approved,
      headline: claude.headline,
      grade: confluence.grade,
      score: confluence.score,
      direction: confluence.direction,
      mutate,
    });
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
      confirmations: null,
      technicals: techSum,
      mtf,
      watch: watchState,
      telemetry,
    };
  }

  const dir = confluence.direction;
  const optionTicketRaw = await buildOptionTicket(desk.price, dir, confluence.grade);
  const executionSim = buildOptionExecutionSim(optionTicketRaw, dir, desk.price, desk);
  const optionTicket: OptionTicket = executionSim
    ? {
        ...optionTicketRaw,
        execution_sim: {
          ...executionSim,
          greeks_snapshot: buildGreeksSnapshot({
            direction: dir,
            entry_spot: desk.price,
            option_mid: optionTicketRaw.mid ?? 0,
            delta: optionTicketRaw.delta,
            execution_sim: executionSim,
          }),
        },
      }
    : optionTicketRaw;

  const sessionGovernor = entryGatesRaw.trade_governor ?? {
    blocks: [],
    warnings: [],
    size_multiplier: 1,
    tier: "normal" as const,
    emergency_shutdown: false,
  };
  const optionGovernor = mergeTradeGovernorWithOptionOverlay(sessionGovernor, {
    mid: optionTicket.mid,
    spread_pct: optionTicket.spread_pct,
    blocked: optionTicket.blocked,
    block_reason: optionTicket.block_reason,
  });
  if (optionGovernor.blocks.length) {
    if (mutate && playbookLabActive && playbookPrimaryId && dir) {
      await commitPlaybookInstanceCancelled({
        session_date: sessionDate,
        playbook_id: playbookPrimaryId,
        direction: dir,
        desk,
        technicals,
        reason: optionGovernor.blocks.join("; "),
      });
    }
    return {
      ...scanningPayload(desk, confluence, pickIdleMessage(), {
        passed: false,
        blocks: optionGovernor.blocks,
        blocks_by_category: categorizeGateBlocks(optionGovernor.blocks),
        warnings: [...entryGatesRaw.warnings, ...optionGovernor.warnings],
        entry_mode: "none",
        play_idea: entryGatesView.play_idea,
      }, sessionExtras),
      confirmations: null,
      technicals: techSum,
      mtf,
      option_ticket: optionTicket,
      watch: watchState,
      telemetry,
    };
  }

  spxPlayDebug('[spx-play-engine] optionTicket check:', {
    blocked: optionTicket.blocked,
    reason: optionTicket.block_reason,
    ticker: optionTicket.ticker,
    strike: optionTicket.strike,
    option_type: optionTicket.option_type,
    contract_label: optionTicket.contract_label,
    bid: optionTicket.bid,
    ask: optionTicket.ask,
  });

  if (optionTicket.blocked && playOptionChainRequired()) {
    if (mutate && playbookLabActive && playbookPrimaryId && dir) {
      await commitPlaybookInstanceCancelled({
        session_date: sessionDate,
        playbook_id: playbookPrimaryId,
        direction: dir,
        desk,
        technicals,
        reason: optionTicket.block_reason ?? "Option chain unavailable",
      });
    }
    return {
      ...scanningPayload(desk, confluence, pickIdleMessage(), {
        passed: false,
        blocks: [optionTicket.block_reason ?? "Option chain unavailable"],
        blocks_by_category: categorizeGateBlocks([
          optionTicket.block_reason ?? "Option chain unavailable",
        ]),
        warnings: entryGatesRaw.warnings,
        entry_mode: "none",
        play_idea: entryGatesView.play_idea,
      }, sessionExtras),
      confirmations: null,
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

  const entryPath = promoteEligible ? "watch_promote" : playbookLabActive ? "playbook_lab" : "cold_buy";
  const promotePrefix = promoteEligible ? "WATCH→ENTRY · " : playbookLabActive ? `${playbookPrimaryId} · ` : "";
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

  spxPlayDebug('[spx-play-engine] ALL GATES PASSED — opening play:', {
    grade: confluence.grade,
    score: confluence.score,
    direction: dir,
    price: desk.price,
    mutate,
    optionBlocked: optionTicket.blocked,
    optionLabel: optionTicket.contract_label,
    claudeVerdict: claude.verdict,
    claudeSource: claude.source,
  });

  const openedAt = new Date().toISOString();
  let playbookInstanceId: string | null = null;
  if (playbookPrimaryId) {
    await commitPlaybookInstanceEntryPending({
      session_date: sessionDate,
      playbook_id: playbookPrimaryId,
      direction: dir,
      desk,
      technicals,
      detail: `ticket ${optionTicket.contract_label ?? "generated"}`,
    });
    await commitPlaybookInstanceOpen({
      session_date: sessionDate,
      playbook_id: playbookPrimaryId,
      direction: dir,
      desk,
      technicals,
      detail: `openPlay ${entryPath}`,
    });
    playbookInstanceId = await resolveActivePlaybookInstanceId(
      sessionDate,
      playbookPrimaryId,
      dir
    );
  }

  const { row: opened, created } = await openPlay(
    {
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
      playbook_id: playbookPrimaryId,
    },
    {
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
      playbook_id: playbookPrimaryId,
      playbook_instance_id: playbookInstanceId,
    }
  );

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
      confirmations: null,
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
      blocks_by_category: emptyCategorizedGateBlocks(),
      first_block_category: null,
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

/**
 * Public entry point — thin wrapper around evaluateSpxPlayCore below whose ONLY job is
 * the task #108 retrospective snapshot log: firing maybeLogSpxEngineSnapshot with
 * whatever payload the core evaluator produced, on every mutate:true call (i.e. every
 * real poll tick from spx-evaluator.ts's runSpxEvaluator — see that file's
 * runSpxEvaluator), regardless of which branch inside evaluateSpxPlayCore produced it
 * (closed-session SCANNING, gate-blocked/Claude-vetoed SCANNING, WATCHING near-miss,
 * or a committed OPEN/SELL). Read-only snapshot callers (getSpxPlaySnapshot,
 * spx-evaluator.ts's readSpxPlaySnapshot) always pass mutate:false, so they never
 * write here — same "no member-facing read triggers a persistence side effect"
 * contract every other write in this file already holds itself to.
 *
 * Wrapping the whole function (rather than adding a maybeLogSpxEngineSnapshot call
 * inside each of evaluateSpxPlayCore's several return points) is deliberate: it's a
 * pure, additive, zero-risk way to observe EVERY exit path through one single choke
 * point without touching a single line of the actual gate/score/branching logic
 * below — this is a read-only telemetry write, not a behavior change.
 */
export async function evaluateSpxPlay(
  desk: SpxDeskPayload,
  prefetchedTechnicals?: PlayTechnicals | null,
  options?: EvaluateSpxPlayOptions
): Promise<SpxPlayPayload> {
  const payload = await evaluateSpxPlayCore(desk, prefetchedTechnicals, options);
  if (options?.mutate === true) {
    firePlayTelemetry("maybeLogSpxEngineSnapshot", () =>
      maybeLogSpxEngineSnapshot({
        phase: payload.phase,
        action: payload.action,
        direction: payload.direction,
        score: payload.score,
        thesis: payload.thesis,
        headline: payload.headline,
        gates: { passed: payload.gates.passed, blocks: payload.gates.blocks },
        as_of: payload.as_of,
      })
    );
  }
  const session = await loadPlaySessionMeta();
  return enrichPlayPayload(payload, desk, session);
}

async function evaluateSpxPlayCore(
  desk: SpxDeskPayload,
  prefetchedTechnicals?: PlayTechnicals | null,
  options?: EvaluateSpxPlayOptions
): Promise<SpxPlayPayload> {
  const mutate = options?.mutate === true;
  const premarket = isPremarketPlanningWindow();
  if (!desk.market_open && !premarket) {
    // Safety net: if a 0DTE play is still open after the cash close (e.g. a missed 15:50
    // force-exit tick), fall through to the normal evaluation so evaluateOpenPlay's
    // SESSION-close branch (!market_open → exit_action 'SESSION') force-settles it. Needs
    // a real price to settle at; with none, render SCANNING and let a later in-window tick
    // settle. No open play → plain closed-session SCANNING as before.
    const openAfterClose = desk.price > 0 ? await loadOpenPlay() : null;
    if (!openAfterClose) {
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
        blocks_by_category: categorizeGateBlocks(["Session closed"]),
        first_block_category: firstGateBlockCategory(["Session closed"]),
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

  const [rawConfluence, nhBonus] = await Promise.all([
    Promise.resolve(computeSpxConfluence(desk)),
    getNhConfluenceBonus(),
  ]);
  const confluence = rawConfluence;
  if (!confluence) {
    return scanningPayload(desk, null, pickIdleMessage());
  }

  // SHADOW-MODE factor logging (src/lib/spx-signals-shadow.ts) — fire-and-forget,
  // purely observational. Captures the RAW confluence.score/grade from
  // computeSpxConfluence() above, BEFORE the Night Hawk prior bonus just below
  // mutates confluence.score, so the logged "actual_score" pairs each shadow
  // observation with the pure engine output it should be correlated against.
  // computeSpxConfluence()'s return value itself is untouched by this call —
  // see spx-signals.test.ts's byte-for-byte proof.
  firePlayTelemetry("logSpxShadowFactors", () =>
    logSpxShadowFactors(desk, { score: confluence.score, grade: confluence.grade })
  );
  // SHADOW-MODE factor logging, part 2 (src/lib/spx-signals-shadow-skew.ts): risk-reversal
  // skew + realized-vs-implied vol. Same non-blocking idiom, same "read BEFORE the Night Hawk
  // prior bonus mutates confluence.score" contract as logSpxShadowFactors just above.
  firePlayTelemetry("logSpxSkewShadowFactors", () =>
    logSpxSkewShadowFactors(desk, { score: confluence.score, grade: confluence.grade })
  );

  // SHADOW-MODE macro-prediction factor logging (src/lib/spx-signals-shadow-predictions.ts)
  // — sibling of the call above, same fire-and-forget/purely-observational contract, same
  // pre-Night-Hawk-bonus score/grade snapshot. Observes UW prediction-market consensus
  // specifically around macroHardBlock's own CPI/FOMC/NFP/PPI/GDP hard-block windows
  // (spx-play-gates.ts) — zero effect on computeSpxConfluence()'s actual return value.
  firePlayTelemetry("logSpxMacroPredictionsShadowFactor", () =>
    logSpxMacroPredictionsShadowFactor(desk, { score: confluence.score, grade: confluence.grade })
  );

  // SHADOW-MODE ecosystem-context factor logging (src/lib/spx-signals-shadow-ecosystem.ts)
  // — the BIE-mediated generalization of the getNhConfluenceBonus() pattern
  // below to 0DTE Command, plus a differentiated SPX-ticker-scoped flow-
  // anomaly read. Same fire-and-forget, observation-only contract as
  // logSpxShadowFactors immediately above: captures confluence.direction
  // BEFORE the Night Hawk prior bonus below can mutate confluence.score (it
  // never touches .direction, but capturing both together here keeps this
  // call and the one above reading identically-aged confluence state).
  // computeSpxConfluence()'s return value itself is untouched by this call —
  // see spx-signals.test.ts's byte-for-byte proof.
  firePlayTelemetry("logSpxEcosystemShadowFactors", () =>
    logSpxEcosystemShadowFactors(desk, {
      score: confluence.score,
      grade: confluence.grade,
      direction: confluence.direction,
    })
  );

  // SHADOW-MODE factor logging, catalyst edition (src/lib/spx-signals-shadow-
  // catalysts.ts) — same fire-and-forget idiom, same pre-Night-Hawk-bonus
  // score/grade snapshot as logSpxShadowFactors just above, kept as its own
  // call (not folded into logSpxShadowFactors) so each shadow factor's
  // wiring is independently reviewable/revertible.
  firePlayTelemetry("logMegaCapCatalystShadowFactors", () =>
    logMegaCapCatalystShadowFactors(desk, { score: confluence.score, grade: confluence.grade })
  );

  // SHADOW-MODE precedent-search factor logging (src/lib/spx-signals-shadow-
  // precedents.ts) — same fire-and-forget idiom, same pre-Night-Hawk-bonus
  // score/grade snapshot as logSpxShadowFactors above. Queries BIE's semantic
  // precedent search (get_similar_precedents) for historical SPX-relevant
  // setups similar to right now, and derives a provisional weight from how
  // they actually resolved — needs confluence.direction (like the ecosystem
  // call above) to know what "same direction as this precedent" means.
  firePlayTelemetry("logSpxPrecedentsShadowFactor", () =>
    logSpxPrecedentsShadowFactor(desk, {
      score: confluence.score,
      grade: confluence.grade,
      direction: confluence.direction,
    })
  );

  // NH morning prior: inject the Night Hawk evening signal as a signed confluence factor.
  // Bounded at ±3 — a soft prior, not an override. Only applies when the edition is fresh
  // (< 20h old) and shows a clear directional A-grade cluster.
  if (nhBonus && nhBonus.bonus !== 0) {
    confluence.score += nhBonus.bonus;
    confluence.factors.push({
      label: "Night Hawk prior",
      weight: nhBonus.bonus,
      detail: nhBonus.label,
    });
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

  return evaluateFlatPlay(desk, confluence, technicals, confirmations, mutate, {
    or_break_memory: options?.or_break_memory,
    playbook_resolved: options?.playbook_resolved,
  });
}
