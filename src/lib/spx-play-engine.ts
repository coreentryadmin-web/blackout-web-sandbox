import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import {
  computeSpxConfluence,
  type SpxConfluence,
  type SpxPlayAction,
  type SpxPlayDirection,
  type SpxSignalFactor,
} from "@/lib/spx-signals";
import { evaluatePlayGates } from "@/lib/spx-play-gates";
import { evaluatePlayConfirmations } from "@/lib/spx-play-confirmations";
import { buildPlayTechnicals, type PlayTechnicals } from "@/lib/spx-play-technicals";
import type { PlayConfirmationResult } from "@/lib/spx-play-confirmations";
import { evaluateClaudePlayApproval, type ClaudePlayVerdict } from "@/lib/spx-play-claude";
import { pickIdleMessage, watchMessage } from "@/lib/spx-play-idle";
import {
  gradeRank,
  playFullMinScore,
  playOptionChainRequired,
  playThesisBreakScore,
  playTrimMfePts,
  playWatchMinScore,
} from "@/lib/spx-play-config";
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
  as_of: string;
};

function pnlPts(direction: SpxPlayDirection, entry: number, exit: number): number {
  return direction === "long" ? exit - entry : entry - exit;
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

function scanningPayload(
  desk: SpxDeskPayload,
  confluence: SpxConfluence | null,
  idle: string,
  gates?: SpxPlayPayload["gates"],
  extras?: Partial<SpxPlayPayload>
): SpxPlayPayload {
  return {
    available: Boolean(desk.available && desk.market_open),
    phase: "SCANNING",
    action: "SCANNING",
    direction: confluence?.direction ?? null,
    grade: confluence?.grade ?? "D",
    score: confluence?.score ?? 0,
    confidence: confluence?.confidence ?? 0,
    headline: idle,
    thesis: gates?.blocks[0] ?? "No A+ setup yet — scanning all lanes.",
    idle_message: idle,
    factors: confluence?.factors ?? [],
    levels: confluence?.levels ?? { entry: null, stop: null, target: null, invalidation: "" },
    gates: gates ?? { passed: false, blocks: [], warnings: [], entry_mode: "none" },
    claude: null,
    open_play: null,
    confirmations: null,
    technicals: null,
    mtf: null,
    option_ticket: null,
    watch: null,
    telemetry: null,
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
  telemetry: SpxPlayPayload["telemetry"]
): Promise<SpxPlayPayload> {
  const price = desk.price;
  const dir = row.direction;
  const mfe = Math.max(row.mfe_pts, dir === "long" ? price - row.entry_price : row.entry_price - price);
  const mae = Math.max(row.mae_pts, dir === "long" ? row.entry_price - price : price - row.entry_price);
  await updateOpenPlay(row.id, { mfe_pts: mfe, mae_pts: mae });

  let action: SpxPlayAction = "HOLD";
  let headline = `${row.grade} ${dir === "long" ? "CALL" : "PUT"} working`;
  let thesis = `Managing open ${dir} from ${row.entry_price.toFixed(2)} — thesis intact.`;

  const stop = row.stop;
  const target = row.target;

  const stopHit = stop != null && (dir === "long" ? price <= stop : price >= stop);
  const targetHit = target != null && (dir === "long" ? price >= target : price <= target);

  const thesisBreak =
    dir === "long"
      ? confluence.score <= -playThesisBreakScore()
      : confluence.score >= playThesisBreakScore();

  const trimZone =
    !row.trim_done &&
    mfe >= playTrimMfePts() &&
    target != null &&
    (dir === "long"
      ? target - price <= Math.max(4, (target - row.entry_price) * 0.2)
      : price - target <= Math.max(4, (row.entry_price - target) * 0.2));

  const closeSnapshot = (exitAction: PlayExitAction, wasLoss: boolean, trimDone: boolean) => ({
    exit_price: price,
    exit_action: exitAction,
    mfe_pts: mfe,
    mae_pts: mae,
    trim_done: trimDone,
    was_loss: wasLoss,
    pnl_pts: pnlPts(dir, row.entry_price, price),
  });

  if (stopHit || thesisBreak || !desk.market_open) {
    action = "SELL";
    headline = stopHit
      ? "STOP — structure broken"
      : !desk.market_open
        ? "SESSION FLAT — close 0DTE"
        : "THESIS BREAK — exit";
    thesis = stopHit
      ? `Price ${price.toFixed(2)} through stop ${stop?.toFixed(0)}. Flatten.`
      : thesisBreak
        ? `Confluence flipped against ${dir} position (score ${confluence.score}).`
        : "Cash session closed — flatten runners.";
    await closeOpenPlay(row.id, {
      was_loss: stopHit || thesisBreak,
      direction: dir,
      close: closeSnapshot(
        stopHit ? "STOP" : !desk.market_open ? "SESSION" : "THESIS",
        stopHit || thesisBreak,
        row.trim_done
      ),
    });
    void maybeLogSpxPlay(
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
    ).catch(() => undefined);
  } else if (targetHit) {
    action = "SELL";
    headline = "TARGET — take profit";
    thesis = `Hit target zone ${target?.toFixed(0)} from ${row.entry_price.toFixed(2)}.`;
    await closeOpenPlay(row.id, {
      was_loss: false,
      direction: dir,
      close: closeSnapshot("TARGET", false, row.trim_done),
    });
    void maybeLogSpxPlay(
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
    ).catch(() => undefined);
  } else if (trimZone) {
    action = "TRIM";
    headline = "TRIM — bank partial, trail runner";
    thesis = `+${mfe.toFixed(1)} pts MFE into target — trim ~50%, hold runner.`;
    await updateOpenPlay(row.id, { trim_done: true });
    void maybeLogSpxPlay(
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
    ).catch(() => undefined);
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
    gates: { passed: false, blocks: [], warnings: [], entry_mode: "none" },
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
    as_of: confluence.as_of,
  };
}

async function evaluateFlatPlay(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  technicals: PlayTechnicals,
  confirmations: PlayConfirmationResult
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
  });
  const abs = Math.abs(confluence.score);
  const techSum = technicalsSummary(technicals, mtf);

  const watchRec = await loadWatchRecord();
  const promoteEval =
    direction != null
      ? await evaluateWatchPromote({
          direction,
          price: desk.price,
          level: keyLevel,
          hybridHardOk: mtfHardPass(direction, keyLevel, technicals),
          score: abs,
          fullMinScore: fullMin,
        })
      : { eligible: false, reason: "No direction", record: watchRec };

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
    active: Boolean(watchRec),
    promote_ready: promoteEligible,
    reason: promoteReason,
    since: watchRec?.first_at ?? null,
  };

  const nearMiss =
    gradeRank(confluence.grade) >= 3 &&
    abs >= fullMin - 8 &&
    confirmations.passed_count >= confirmations.total - 2 &&
    !gates.passed &&
    !promoteEligible;

  const watchBand =
    direction != null &&
    gradeRank(confluence.grade) >= 2 &&
    abs >= playWatchMinScore() &&
    Boolean(mtf?.ok);

  if ((nearMiss || watchBand) && direction != null && mtf) {
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
      ...scanningPayload(desk, confluence, watchMessage(confluence.grade, dirLabel), {
        passed: false,
        blocks: gates.blocks,
        warnings: gates.warnings,
        entry_mode: gates.entry_mode,
      }),
      phase: "WATCHING",
      action: "WATCHING",
      headline: `${confluence.grade} ${dirLabel} — almost there`,
      thesis:
        gates.blocks[0] ??
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

  let entryGates = gates;
  if (promoteEligible && direction != null) {
    const promoteBlocks = [...gates.blocks];
    if (adaptive.promote_blocked && adaptive.promote_block_reason) {
      promoteBlocks.push(adaptive.promote_block_reason);
    }
    entryGates = {
      ...gates,
      blocks: promoteBlocks.filter((b) => !b.includes("cooldown") && !b.includes("below minimum")),
      warnings: [
        ...gates.warnings,
        ...(adaptive.promote_min_score_boost > 0
          ? [`Telemetry promote floor +${adaptive.promote_min_score_boost}`]
          : []),
      ],
    };
    if (abs >= promoteMin && entryGates.entry_mode === "full" && !adaptive.promote_blocked) {
      entryGates = { ...entryGates, passed: entryGates.blocks.length === 0 };
    } else {
      entryGates = { ...entryGates, passed: false, entry_mode: "none" };
    }
  }

  if (!entryGates.passed) {
    return {
      ...scanningPayload(desk, confluence, pickIdleMessage(), {
        passed: false,
        blocks: entryGates.blocks,
        warnings: entryGates.warnings,
        entry_mode: entryGates.entry_mode,
      }),
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
      thesis: watchBand
        ? `MTF ladder ${mtf?.summary ?? ""} · waiting for full gate pass.`
        : entryGates.blocks[0] ?? pickIdleMessage(),
    };
  }

  const claude = await evaluateClaudePlayApproval(desk, confluence, entryGates, confirmations, technicals);

  if (!claude.approved || !confluence.direction) {
    return {
      ...scanningPayload(desk, confluence, pickIdleMessage(), {
        passed: false,
        blocks:
          claude.verdict === "VETO"
            ? [`Claude veto: ${claude.headline}`]
            : entryGates.blocks,
        warnings: entryGates.warnings,
        entry_mode: entryGates.entry_mode,
      }),
      phase: "SCANNING",
      action: "SCANNING",
      headline: claude.headline,
      thesis: claude.thesis,
      claude,
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
        warnings: entryGates.warnings,
        entry_mode: "none",
      }),
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
      telemetry
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

  const openedAt = new Date().toISOString();
  const opened = await openPlay({
    session_date: sessionDate,
    direction: dir,
    entry_price: desk.price,
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

  await recordBuy(dir);
  if (promoteEligible) await consumeWatchRecord();

  void recordPlayEntry({
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
  }).catch(() => undefined);

  void maybeLogSpxPlay(
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
  ).catch(() => undefined);

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
      warnings: entryGates.warnings,
      entry_mode: entryGates.entry_mode,
    },
    claude,
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
    as_of: confluence.as_of,
  };
}

export async function evaluateSpxPlay(
  desk: SpxDeskPayload,
  prefetchedTechnicals?: PlayTechnicals | null
): Promise<SpxPlayPayload> {
  if (!desk.market_open) {
    return {
      available: false,
      phase: "SCANNING",
      action: "SCANNING",
      direction: null,
      grade: "D",
      score: 0,
      confidence: 0,
      headline: "Session closed",
      thesis: `Desk offline · ${desk.market_label ?? "CLOSED"} · resumes 6:30 AM PT`,
      idle_message: null,
      factors: [],
      levels: { entry: null, stop: null, target: null, invalidation: "" },
      gates: { passed: false, blocks: ["Session closed"], warnings: [], entry_mode: "none" },
      claude: null,
      open_play: null,
      confirmations: null,
      technicals: null,
      mtf: null,
      option_ticket: null,
      watch: null,
      telemetry: null,
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
    return evaluateOpenPlay(desk, confluence, open, technicals, confirmations, mtf, telemetry);
  }

  return evaluateFlatPlay(desk, confluence, technicals, confirmations);
}
