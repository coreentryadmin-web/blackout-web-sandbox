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
  playOnlyFullEntry,
  playOpeningRangeMinutes,
  playReentryLockSec,
  playStarterMinScore,
  playWatchMinScore,
  playWeightedConflictBlockMin,
} from "@/lib/spx-play-config";
import { isPastNoEntryCutoff, isBeforeCashOpen, cashOpenLabel, noEntryCutoffLabel } from "@/lib/spx-play-session-guards";
import { etClock, etMinutes, formatEtTime } from "@/lib/spx-play-session-time";

export type PlayGateResult = {
  passed: boolean;
  blocks: string[];
  warnings: string[];
  entry_mode: "none" | "starter" | "full";
  play_idea: string | null;
};

function parseMacroEventMinutes(timeRaw: string, todayYmd: string): number | null {
  const time = timeRaw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(time)) {
    if (time !== todayYmd) return null;
    return 8 * 60 + 30;
  }
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
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

    const eventMins = parseMacroEventMinutes(String(ev.time ?? ""), todayYmd);
    if (eventMins == null) continue;

    const isAfternoonFed =
      title.includes("FOMC") || title.includes("FED") || title.includes("RATE DECISION");

    if (isAfternoonFed) {
      const fedMins = eventMins >= 12 * 60 ? eventMins : 14 * 60;
      if (mins >= fedMins - 15 && mins <= fedMins + 15) {
        return `Macro hard block: ${title.slice(0, 40)} (Fed window)`;
      }
      continue;
    }

    if (mins >= eventMins - 5 && mins <= eventMins + 60) {
      const label = String(ev.time ?? "08:30").slice(0, 5);
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
  const dir = confluence.bias === "bullish" ? "long" : confluence.bias === "bearish" ? "short" : null;
  const buyIntent = opts?.entry_intent !== "watch";

  if (!desk.market_open) {
    blocks.push("Session closed — no new entries");
  }

  const halt = shouldBlockForTradingHalt(undefined, {
    failClosedOnStale: desk.market_open === true,
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
