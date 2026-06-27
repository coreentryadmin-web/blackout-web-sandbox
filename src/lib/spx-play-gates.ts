import type { SpxConfluence } from "@/lib/spx-signals";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { PlayConfirmationResult } from "@/lib/spx-play-confirmations";
import { buildPlayIdeaIntel } from "@/lib/spx-play-intel";
import { shouldBlockForTradingHalt } from "@/lib/ws/uw-socket";
import { todayEtYmd } from "@/lib/providers/spx-session";
import {
  gradeRank,
  playBuyCooldownAplusBypass,
  playBuyCooldownSec,
  playCooldownAfterStopMin,
  playFullMinScore,
  playGexStaleMaxSec,
  playMinAgreeingFactors,
  playMinGradeRank,
  playMinRiskReward,
  playOnlyFullEntry,
  playOpeningRangeMinutes,
  playReentryLockSec,
  playStarterMinScore,
  playWatchMinScore,
  playWeightedConflictBlockMin,
} from "@/lib/spx-play-config";
import { isPastNoEntryCutoff, isBeforeCashOpen, cashOpenLabel, noEntryCutoffLabel } from "@/lib/spx-play-session-guards";
import { etClock, etMinutes, formatEtTime } from "@/lib/spx-play-session-time";
import { parseMacroEventTime, macroBlockWindow } from "@/lib/spx-macro-window";

export type PlayGateResult = {
  passed: boolean;
  blocks: string[];
  warnings: string[];
  entry_mode: "none" | "starter" | "full";
  play_idea: string | null;
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
} as const;

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
  },
  confirmations?: PlayConfirmationResult | null,
  opts?: { min_score_boost?: number; entry_intent?: "buy" | "watch" }
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

  if (!desk.market_open) {
    blocks.push("Session closed — no new entries");
  }

  // Stale halt feed → fail-OPEN (allow play to proceed) with a warning so the operator
  // can see feed degradation without blocking valid entries. A real, fresh active-halt
  // still blocks as before. The previous fail-closed-on-stale behavior was too aggressive:
  // a transient UW WS gap during RTH would block all entries even when no halt existed.
  const haltStale = desk.halt_channel_stale === true;
  if (haltStale) {
    console.warn("[spx-play-gates] halt channel stale — failing OPEN (allowing play); monitor UW WS");
    warnings.push("Halt feed stale (UW channel offline) — proceeding fail-open; verify no active halts");
  }
  const halt = shouldBlockForTradingHalt(undefined, {
    failClosedOnStale: false, // never block on staleness — only block on a confirmed live halt
  });
  if (halt.block && halt.reason) {
    blocks.push(halt.reason);
  }

  if (!desk.gex_walls?.length) {
    blocks.push("GEX walls required — no entry without dealer map");
  }

  const polledAt = desk.polled_at ?? desk.as_of;
  if (polledAt) {
    const ageSec = (Date.now() - new Date(polledAt).getTime()) / 1000;
    if (ageSec > playGexStaleMaxSec()) {
      blocks.push(`Desk data stale (${Math.round(ageSec)}s)`);
    }
  }

  if (confluence.weighted_conflicts >= playWeightedConflictBlockMin()) {
    blocks.push("Tape's mixed — too many conflicting signals for clean entry");
  }

  if (gradeRank(confluence.grade) < playMinGradeRank()) {
    blocks.push(`Grade ${confluence.grade} below minimum (need B or better)`);
  }

  const macro = macroHardBlock(desk);
  if (macro) blocks.push(macro);

  if (buyIntent && isBeforeCashOpen()) {
    blocks.push(`Pre-market — no 0DTE BUY until ${cashOpenLabel()} cash open (lotto watch ok)`);
  }

  if (buyIntent && isPastNoEntryCutoff()) {
    blocks.push(`After ${noEntryCutoffLabel()} — no new 0DTE entries`);
  }

  const etMins = etMinutes(new Date());
  if (buyIntent && etMins < 7 * 60 + 0) {
    blocks.push("Before 7:00 AM ET — opening volatility, no entries");
  }

  const openingRangeEnd = etClock(9, 30) + playOpeningRangeMinutes();
  if (buyIntent && etMins < openingRangeEnd) {
    const endMinRaw = 30 + playOpeningRangeMinutes();
    const endHour = 9 + Math.floor(endMinRaw / 60);
    const endMinClamped = endMinRaw % 60;
    blocks.push(`Opening range — no BUY until ${formatEtTime(endHour, endMinClamped)} (WATCH ok)`);
  }

  if (abs < playWatchMinScore()) {
    blocks.push(`Score ${abs} too low — quality setups only`);
  }

  if (scoreBoost > 0) {
    warnings.push(`Adaptive score floor +${scoreBoost} (telemetry)`);
  }

  let entry_mode: PlayGateResult["entry_mode"] = "none";
  if (abs >= fullMin && confluence.weighted_conflicts <= 2) {
    entry_mode = "full";
  } else if (!playOnlyFullEntry() && abs >= playStarterMinScore() && confluence.weighted_conflicts <= 3) {
    entry_mode = "starter";
  }

  if (playOnlyFullEntry() && entry_mode === "starter") {
    entry_mode = "none";
    warnings.push("Starter size disabled — full A/A+ only");
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
    } else {
      blocks.push(
        `Buy cooldown (${Math.round(buyCooldownSec / 60)}m after any exit — ${minsSinceExit}m elapsed)`
      );
    }
  }

  if (
    buyIntent &&
    session.last_stop_at &&
    now - session.last_stop_at < playCooldownAfterStopMin() * 60_000
  ) {
    blocks.push(`Post-STOP cooldown (${playCooldownAfterStopMin()}m — STOP exits only, WATCH ok)`);
  }

  if (
    buyIntent &&
    session.last_sell_was_loss &&
    session.last_sell_at &&
    session.last_direction &&
    dir === session.last_direction &&
    now - session.last_sell_at < playReentryLockSec() * 1000
  ) {
    blocks.push(
      `Re-entry lock after loss (${Math.round(playReentryLockSec() / 60)}m same direction — STOP + THESIS)`
    );
  }

  // Flow staleness: if the UW flow feed has been silent > 5 min, entries are blocked —
  // the tape signal and 0DTE flow score are based on data that may no longer reflect
  // current market structure. Warning at 2 min so the trader sees degraded data early.
  const flowAgeMs = desk.flow_data_age_ms;
  if (buyIntent && flowAgeMs != null && flowAgeMs > 300_000) {
    blocks.push(`Flow data stale (${Math.round(flowAgeMs / 60_000)}m) — tape and 0DTE signals unreliable`);
  } else if (flowAgeMs != null && flowAgeMs > 120_000) {
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

  if (desk.vix != null && desk.vix > 32) {
    blocks.push(`VIX ${desk.vix.toFixed(1)} too hot for new 0DTE entries`);
  } else if (desk.vix != null && desk.vix > 28) {
    warnings.push(`Elevated VIX ${desk.vix.toFixed(1)}`);
  }

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
    if (!confirmations.passed) {
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

  return { passed, blocks, warnings, entry_mode, play_idea };
}
