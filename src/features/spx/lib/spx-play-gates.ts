import type { SpxConfluence } from "@/features/spx/lib/spx-signals";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayConfirmationResult } from "@/features/spx/lib/spx-play-confirmations";
import { buildPlayIdeaIntel } from "@/features/spx/lib/spx-play-intel";
import { shouldBlockForTradingHalt } from "@/lib/ws/uw-socket";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { isStagingDeploy } from "@/lib/clerk-env";
import {
  gradeRank,
  playBuyCooldownAplusBypass,
  playBuyCooldownSec,
  playCooldownAfterStopMin,
  playColdBuyMinScore,
  playFullMinScore,
  playGexStaleMaxSec,
  playMinAgreeingFactors,
  playMinGradeRank,
  playMinRiskReward,
  playOnlyFullEntry,
  playReentryLockSec,
  playSessionMaxEntries,
  playSessionMaxLosses,
  playStarterMinScore,
  playWatchMinScore,
  playWeightedConflictBlockMin,
  playbookLiveGateEnabled,
  playbookLiveAllowlist,
  playbookStagingLabEnabled,
  isPlaybookLiveAllowlisted,
} from "@/features/spx/lib/spx-play-config";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import { isUnknownPlaybookRegime } from "@/features/spx/lib/playbook-regime-router";
import {
  liveDataQualityMode,
  playbookDataQualityFlags,
  shouldFailClosedLiveOnDataQuality,
} from "@/features/spx/lib/playbook-data-quality";
import {
  haltStaleEntryBlocked,
  playbookDataQualityBlockReason,
  playbookDataRequirements,
} from "@/features/spx/lib/playbook-data-requirements";
import { playbookDef } from "@/features/spx/lib/playbook-registry";
import {
  categorizeGateBlocks,
  firstGateBlockCategory,
  type CategorizedGateBlocks,
  type GateBlockCategory,
} from "@/features/spx/lib/playbook-gate-categories";
import {
  evaluateTradeGovernor,
  type TradeGovernorResult,
} from "@/features/spx/lib/trade-governor";
import { isPastNoEntryCutoff, isBeforeCashOpen, cashOpenLabel, noEntryCutoffLabel } from "@/features/spx/lib/spx-play-session-guards";
import { etClock, etMinutes, formatEtTime } from "@/features/spx/lib/spx-play-session-time";
import { parseMacroEventTime, macroBlockWindow } from "@/features/spx/lib/spx-macro-window";

export type PlayGateResult = {
  passed: boolean;
  blocks: string[];
  blocks_by_category: CategorizedGateBlocks;
  /** First failing gate layer (operational → playbook_validity → risk → quality). */
  first_block_category: GateBlockCategory | null;
  warnings: string[];
  entry_mode: "none" | "starter" | "full";
  play_idea: string | null;
  /** Staging lab degraded-size multiplier (1 = full size). */
  playbook_size_multiplier?: number;
  /** Session-level governor from gates (option overlay applied later in engine). */
  trade_governor?: TradeGovernorResult;
};

/**
 * Stable prefixes for gate block messages that the promote filter pattern-matches on.
 * Use these constants instead of bare string literals to avoid silent breakage when
 * user-facing block messages are reworded.
 */
export const GATE_BLOCK = {
  BUY_COOLDOWN: "Buy cooldown",
  QUALITY_COOLDOWN: "Quality cooldown",
  GRADE_BELOW_MIN: "below minimum",
  REENTRY_LOCK: "Re-entry lock",
  MIXED_TAPE: "Tape's mixed",
} as const;

/** Grade-scaled mixed-tape hard block — A setups tolerate one extra soft counter-trend signal. */
export function mixedTapeBlockThreshold(grade: string, absScore?: number): number {
  const base = playWeightedConflictBlockMin();
  const rank = gradeRank(grade);
  let threshold =
    rank >= gradeRank("A") ? base + 1 : rank >= gradeRank("B") ? base : Math.max(3, base - 1);
  // Strong B conviction (|score| ≥ 58) tolerates one extra soft counter — Jul 7–8 audit showed
  // mixed-tape blocking valid directional leans on choppy but one-sided days.
  if (absScore != null && absScore >= 58 && rank >= gradeRank("B")) {
    threshold += 1;
  }
  return threshold;
}

function maxWeightedForEntryMode(grade: string, mode: "full" | "starter"): number {
  const rank = gradeRank(grade);
  if (mode === "full") {
    if (rank >= gradeRank("A")) return 4;
    if (rank >= gradeRank("B")) return 3;
    return 2;
  }
  if (rank >= gradeRank("A")) return 5;
  if (rank >= gradeRank("B")) return 4;
  return 3;
}

function macroHardBlock(desk: SpxDeskPayload): string | null {
  const events = desk.macro_events ?? [];
  const todayYmd = todayEtYmd();
  const mins = etMinutes(new Date());

  for (const ev of events) {
    const title = String(ev.event ?? ev.country ?? "").toUpperCase();
    const isMacro =
      title.includes("CPI") ||
      title.includes("FOMC") ||
      title.includes("FED") ||
      title.includes("NFP") ||
      title.includes("PAYROLL") ||
      title.includes("PPI") ||
      title.includes("GDP");
    if (!isMacro) continue;

    const evTime = parseMacroEventTime(String(ev.time ?? ""), todayYmd);
    if (evTime == null) continue;

    const isAfternoonFed =
      title.includes("FOMC") || title.includes("FED") || title.includes("RATE DECISION");

    if (isAfternoonFed) {
      // Preserve prior behavior: a precise afternoon time uses itself; anything else
      // (including a date-only/imprecise anchor) defaults to the 14:00 ET decision window.
      const fedMins = evTime.precise && evTime.minutes >= 12 * 60 ? evTime.minutes : 14 * 60;
      if (mins >= fedMins - 15 && mins <= fedMins + 15) {
        return `Macro hard block: ${title.slice(0, 40)} (Fed window)`;
      }
      continue;
    }

    // Precise releases get the tight [t-5, t+60] block; date-only/imprecise releases
    // widen to the full morning so a later-than-8:30 print is never left unguarded.
    const win = macroBlockWindow(evTime);
    if (mins >= win.start && mins <= win.end) {
      const label = evTime.precise ? String(ev.time ?? "08:30").slice(0, 5) : "AM";
      return `Macro hard block: ${title.slice(0, 40)} (${label} ET window)`;
    }
  }
  return null;
}

/** Entry gates for the flat path only (SCANNING → WATCH → BUY). Does not manage open plays. */
export function evaluatePlayGates(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  session: {
    last_buy_at: number | null;
    last_sell_at: number | null;
    last_sell_was_loss: boolean;
    last_direction: "long" | "short" | null;
    last_stop_at: number | null;
    session_entries_today?: number;
    session_losses_today?: number;
  },
  confirmations?: PlayConfirmationResult | null,
  opts?: {
    min_score_boost?: number;
    entry_intent?: "buy" | "watch";
    cold_buy_path?: boolean;
    /** When PLAYBOOK_LIVE_GATE=1, BUY requires this primary playbook id. */
    playbook_primary_id?: PlaybookId | null;
    /** Direction from the fired primary verdict — used for staging lab alignment. */
    playbook_primary_direction?: "long" | "short" | null;
    /** Per-playbook trigger counts today — trade governor. */
    triggers_today_by_pb?: ReadonlyMap<string, number>;
    /** Option quote preview for spread/premium governor checks. */
    option_preview?: {
      mid: number | null;
      spread_pct: number | null;
      blocked?: boolean;
      block_reason?: string | null;
    };
    /** WATCH→ENTRY promote or A+ bypass — skips buy-cooldown in trade governor. */
    bypass_buy_cooldown?: boolean;
  }
): PlayGateResult {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const abs = Math.abs(confluence.score);
  const scoreBoost = opts?.min_score_boost ?? 0;
  const fullMin = playFullMinScore() + scoreBoost;
  // Use confluence.direction ("long"/"short"|null) directly rather than re-deriving
  // from bias to keep a single authoritative source for play direction.
  const dir = confluence.direction;
  const buyIntent = opts?.entry_intent !== "watch";
  const stagingLab =
    buyIntent &&
    playbookStagingLabEnabled() &&
    opts?.playbook_primary_id != null &&
    opts?.playbook_primary_direction != null &&
    dir === opts.playbook_primary_direction;

  if (!desk.market_open) {
    blocks.push("Session closed — no new entries");
  }

  let playbookSizeMultiplier = 1;
  let tradeGovernor: TradeGovernorResult | undefined;

  if (buyIntent) {
    const governor = evaluateTradeGovernor({
      buy_intent: true,
      playbook_id: opts?.playbook_primary_id ?? null,
      direction: dir,
      desk,
      session,
      triggers_today_by_pb: opts?.triggers_today_by_pb,
      option: opts?.option_preview,
      bypass_buy_cooldown: opts?.bypass_buy_cooldown === true,
    });
    tradeGovernor = governor;
    blocks.push(...governor.blocks);
    warnings.push(...governor.warnings);
    playbookSizeMultiplier = governor.size_multiplier;
  }

  if (buyIntent && playbookLiveGateEnabled()) {
    const pbId = opts?.playbook_primary_id ?? null;

    if (!pbId) {
      // STAGING FULL-ENABLEMENT (user directive): do NOT strangle the desk when no playbook primary
      // has fired — on staging let plays ALSO flow from the legacy confluence engine (they still face
      // the score/grade quality gates below). PROD keeps requiring a fired primary when the live gate
      // is on (conservative), so prod behavior is UNCHANGED.
      if (!isStagingDeploy()) {
        blocks.push(
          `No playbook trigger — playbook live gate requires a fired primary (staging lab=${playbookStagingLabEnabled()})`
        );
      }
    } else if (!isPlaybookLiveAllowlisted(pbId)) {
      const allowlist = playbookLiveAllowlist();
      const listed = allowlist ? [...allowlist].join(", ") : "none";
      const mode = playbookDef(pbId).execution_mode;
      blocks.push(
        `Playbook ${pbId} not paper-executable (mode=${mode}; allowlist=${listed})`
      );
    } else if (isUnknownPlaybookRegime(desk)) {
      blocks.push("Unknown EMA regime — playbook live gate fail-closed");
    } else {
      const dq = playbookDataQualityFlags(desk);
      const dqMode = liveDataQualityMode(dq);
      if (shouldFailClosedLiveOnDataQuality(dqMode)) {
        blocks.push(
          `Severe data quality (${dqMode}) — live playbook gate fail-closed (halt=${dq.halt_channel_stale}, desk=${dq.desk_stale}, gex=${dq.gex_missing})`
        );
      } else {
        const dqBlock = playbookDataQualityBlockReason(pbId, dq, desk, {
          option_quotes_available: opts?.option_preview != null,
        });
        if (dqBlock) {
          blocks.push(dqBlock);
        } else if (stagingLab) {
          warnings.push(`Playbook lab: primary ${pbId} ${opts?.playbook_primary_direction} armed entry path`);
        }
      }
    }
  }

  const haltStale = desk.halt_channel_stale === true;
  if (haltStale && buyIntent) {
    const pbId = opts?.playbook_primary_id ?? null;
    if (pbId) {
      const haltPolicy = haltStaleEntryBlocked(pbId, playbookDataQualityFlags(desk), desk);
      if (haltPolicy.blocked) {
        if (!blocks.some((b) => b.includes(pbId) && b.includes("halt"))) {
          blocks.push(haltPolicy.reason!);
        }
      } else {
        console.warn(
          "[spx-play-gates] halt channel stale — restricted entry mode (low-velocity setups only)"
        );
        warnings.push(
          "Halt feed stale — restricted mode: low-velocity mean-reversion only; verify no active halts"
        );
      }
    } else {
      console.warn("[spx-play-gates] halt channel stale — no playbook primary; legacy path restricted");
      warnings.push(
        "Halt feed stale — restricted entry mode; playbook primary required on staging lab"
      );
    }
  } else if (haltStale) {
    warnings.push("Halt feed stale (UW channel offline) — monitor before entering");
  }
  const halt = shouldBlockForTradingHalt(undefined, {
    failClosedOnStale: false, // never block on staleness — only block on a confirmed live halt
  });
  if (halt.block && halt.reason) {
    blocks.push(halt.reason);
  }

  const playbookPrimaryId = opts?.playbook_primary_id ?? null;
  const playbookGatedBuy = buyIntent && playbookLiveGateEnabled() && playbookPrimaryId;
  const needsGex =
    playbookGatedBuy
      ? playbookDataRequirements(playbookPrimaryId).gex
      : true;

  if (needsGex && !desk.gex_walls?.length) {
    blocks.push("GEX walls required — no entry without dealer map");
  }

  const polledAt = desk.polled_at ?? desk.as_of;
  let deskStaleSec: number | null = null;
  if (polledAt) {
    deskStaleSec = (Date.now() - new Date(polledAt).getTime()) / 1000;
  }
  if (desk.gex_age_ms != null) {
    const gexSec = desk.gex_age_ms / 1000;
    deskStaleSec = deskStaleSec != null ? Math.max(deskStaleSec, gexSec) : gexSec;
  }
  if (deskStaleSec != null && deskStaleSec > playGexStaleMaxSec()) {
    blocks.push(`Desk data stale (${Math.round(deskStaleSec)}s)`);
  }

  const mixedTapeMsg = `${GATE_BLOCK.MIXED_TAPE} — too many conflicting signals for clean entry`;
  if (confluence.weighted_conflicts >= mixedTapeBlockThreshold(confluence.grade, abs)) {
    if (buyIntent) {
      blocks.push(mixedTapeMsg);
    } else {
      warnings.push(mixedTapeMsg);
    }
  }

  if (gradeRank(confluence.grade) < playMinGradeRank()) {
    const gradeMsg = `Grade ${confluence.grade} below minimum (need B or better)`;
    if (buyIntent) {
      blocks.push(gradeMsg);
    } else {
      warnings.push(gradeMsg);
    }
  }

  const macro = macroHardBlock(desk);
  if (macro) blocks.push(macro);

  if (buyIntent && isBeforeCashOpen()) {
    blocks.push(`Pre-market — no 0DTE BUY until ${cashOpenLabel()} cash open (lotto watch ok)`);
  }

  if (buyIntent && isPastNoEntryCutoff()) {
    blocks.push(`After ${noEntryCutoffLabel()} — no new 0DTE entries`);
  }

  const entriesToday = session.session_entries_today ?? 0;
  const lossesToday = session.session_losses_today ?? 0;

  if (buyIntent && opts?.cold_buy_path && !stagingLab && abs < playColdBuyMinScore()) {
    blocks.push(
      `Cold BUY needs score ≥${playColdBuyMinScore()} (have ${abs}) — WATCH→ENTRY path preferred`
    );
  }
  if (buyIntent && opts?.cold_buy_path && !stagingLab && gradeRank(confluence.grade) < gradeRank("A")) {
    blocks.push("Cold BUY requires grade A or better — B setups need WATCH→ENTRY");
  }

  const etMins = etMinutes(new Date());
  if (buyIntent && etMins < 7 * 60 + 0) {
    blocks.push("Before 7:00 AM ET — opening volatility, no entries");
  }

  // user-directed 2026-07-13: restrict only the first 15 minutes; the 9:45–10:30
  // band is measured by the calibration loop (entry_context.committed_at_et) so
  // this boundary can be revisited with per-play evidence. (Was 9:30 +
  // SPX_PLAY_OPENING_RANGE_MINUTES → 9:50. That env knob still defines the opening
  // RANGE for technicals and watch-drift math — deliberately untouched; only the
  // BUY unlock moved to 9:45. Same boundary as 0DTE Command's G-2 opening-window
  // gate — "0DTE" means BOTH surfaces.)
  const entryUnlockEtMins = etClock(9, 45);
  if (buyIntent && etMins < entryUnlockEtMins) {
    blocks.push(`Opening range — no BUY until ${formatEtTime(9, 45)} (WATCH ok)`);
  }

  if (abs < playWatchMinScore()) {
    blocks.push(`Score ${abs} too low — quality setups only`);
  }

  if (scoreBoost > 0) {
    warnings.push(`Adaptive score floor +${scoreBoost} (telemetry)`);
  }

  let entry_mode: PlayGateResult["entry_mode"] = "none";
  const fullConflictMax = maxWeightedForEntryMode(confluence.grade, "full");
  const starterConflictMax = maxWeightedForEntryMode(confluence.grade, "starter");
  if (abs >= fullMin && confluence.weighted_conflicts <= fullConflictMax) {
    entry_mode = "full";
  } else if (!playOnlyFullEntry() && abs >= playStarterMinScore() && confluence.weighted_conflicts <= starterConflictMax) {
    entry_mode = "starter";
  }

  if (playOnlyFullEntry() && entry_mode === "starter") {
    entry_mode = "none";
    warnings.push("Starter size disabled — full A/A+ only");
  }

  if (
    stagingLab &&
    entry_mode === "none" &&
    abs >= playWatchMinScore() &&
    gradeRank(confluence.grade) >= gradeRank("B") &&
    confluence.weighted_conflicts <= starterConflictMax
  ) {
    entry_mode = "starter";
    warnings.push(`Staging playbook lab — starter entry on ${opts?.playbook_primary_id}`);
  }

  const now = Date.now();
  const buyCooldownSec = playBuyCooldownSec();
  const buyCooldownActive =
    buyIntent &&
    session.last_sell_at != null &&
    now - session.last_sell_at < buyCooldownSec * 1000;
  if (buyCooldownActive) {
    const minsSinceExit = Math.round((now - session.last_sell_at!) / 60_000);
    const aplusBypass =
      playBuyCooldownAplusBypass() && gradeRank(confluence.grade) >= gradeRank("A+");
    if (aplusBypass) {
      warnings.push(
        `A+ setup — buy cooldown bypassed (${minsSinceExit}m since last exit, ${Math.round(buyCooldownSec / 60)}m default)`
      );
    }
    // Non-A+ buy cooldown enforced by Trade Governor
  }

  // Post-stop / re-entry locks enforced by Trade Governor

  // Flow staleness: if the UW flow feed has been silent > 5 min, entries are blocked —
  // unless the cluster heartbeat confirms another replica is delivering live WS frames
  // (this replica's in-memory stamp can lag even when the tape rows are current).
  const flowAgeMs = desk.flow_data_age_ms;
  const clusterLive = desk.flow_cluster_live === true;
  if (buyIntent && flowAgeMs != null && flowAgeMs > 300_000 && !clusterLive) {
    blocks.push(`Flow data stale (${Math.round(flowAgeMs / 60_000)}m) — tape and 0DTE signals unreliable`);
  } else if (flowAgeMs != null && flowAgeMs > 120_000 && !clusterLive) {
    warnings.push(`Flow data ${Math.round(flowAgeMs / 60_000)}m old — tape signal may lag`);
  }

  // R:R enforcement: target must be at least playMinRiskReward()× the stop distance.
  // Only enforced when both levels are defined. A null-stop play is separately flagged
  // via the invalidation text and is the operator's responsibility to size down.
  if (buyIntent && confluence.levels.stop != null && confluence.levels.target != null) {
    const entryPrice = desk.price;
    const stopDist = Math.abs(entryPrice - confluence.levels.stop);
    const targetDist = Math.abs(confluence.levels.target - entryPrice);
    const minRR = playMinRiskReward();
    if (stopDist > 0 && targetDist / stopDist < minRR) {
      blocks.push(
        `R:R ${(targetDist / stopDist).toFixed(2)}:1 below minimum ${minRR}:1 ` +
        `(target ${Math.round(targetDist)} pts / stop ${Math.round(stopDist)} pts)`
      );
    }
  }

  // VIX hot-entry blocks enforced by Trade Governor

  const agreeing =
    confluence.bias === "bullish"
      ? confluence.factors.filter((f) => f.weight > 0).length
      : confluence.bias === "bearish"
        ? confluence.factors.filter((f) => f.weight < 0).length
        : 0;
  if (entry_mode !== "none" && agreeing < playMinAgreeingFactors()) {
    blocks.push(`Only ${agreeing}/${playMinAgreeingFactors()} factors agree`);
    entry_mode = "none";
  }

  if (confirmations) {
    if (!stagingLab && !confirmations.passed) {
      const failed = confirmations.checks.filter((c) => c.required && !c.passed);
      for (const f of failed.slice(0, 3)) {
        blocks.push(`${f.label}: ${f.detail}`);
      }
      if (!failed.length) {
        blocks.push(
          `Confirmations ${confirmations.passed_count}/${confirmations.total} — need stronger alignment`
        );
      }
      entry_mode = "none";
    } else if (stagingLab && !confirmations.passed) {
      warnings.push(
        `Staging playbook lab — confirmations advisory (${confirmations.passed_count}/${confirmations.total})`
      );
    }
  } else {
    blocks.push("Technicals / confirmations unavailable");
    entry_mode = "none";
  }

  const passed =
    blocks.length === 0 &&
    (entry_mode === "full" || entry_mode === "starter") &&
    dir != null;
  const play_idea = buildPlayIdeaIntel(desk, confluence);

  return {
    passed,
    blocks,
    blocks_by_category: categorizeGateBlocks(blocks),
    first_block_category: firstGateBlockCategory(blocks),
    warnings,
    entry_mode,
    play_idea,
    playbook_size_multiplier: playbookSizeMultiplier,
    trade_governor: tradeGovernor,
  };
}
