import type { SpxConfluence } from "@/lib/spx-signals";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { PlayConfirmationResult } from "@/lib/spx-play-confirmations";
import {
  gradeRank,
  playBuyCooldownSec,
  playConflictBlockMin,
  playFullMinScore,
  playGexStaleMaxSec,
  playMinAgreeingFactors,
  playMinGradeRank,
  playOnlyFullEntry,
  playReentryLockSec,
  playStarterMinScore,
  playWatchMinScore,
} from "@/lib/spx-play-config";

export type PlayGateResult = {
  passed: boolean;
  blocks: string[];
  warnings: string[];
  entry_mode: "none" | "starter" | "full";
};

function etMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function macroHardBlock(desk: SpxDeskPayload): string | null {
  const events = desk.macro_events ?? [];
  for (const ev of events) {
    const title = String(ev.event ?? ev.country ?? "").toUpperCase();
    if (title.includes("CPI") || title.includes("FOMC") || title.includes("FED")) {
      const mins = etMinutes(new Date());
      if (mins >= 8 * 60 + 25 && mins <= 10 * 60 + 30) {
        return `Macro hard block: ${title.slice(0, 40)}`;
      }
    }
  }
  return null;
}

export function evaluatePlayGates(
  desk: SpxDeskPayload,
  confluence: SpxConfluence,
  session: {
    last_buy_at: number | null;
    last_sell_at: number | null;
    last_sell_was_loss: boolean;
    last_direction: "long" | "short" | null;
  },
  confirmations?: PlayConfirmationResult | null,
  opts?: { min_score_boost?: number }
): PlayGateResult {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const abs = Math.abs(confluence.score);
  const scoreBoost = opts?.min_score_boost ?? 0;
  const fullMin = playFullMinScore() + scoreBoost;
  const dir = confluence.bias === "bullish" ? "long" : confluence.bias === "bearish" ? "short" : null;

  if (!desk.market_open) {
    blocks.push("Session closed — no new entries");
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

  if (confluence.conflicts >= playConflictBlockMin()) {
    blocks.push(`${confluence.conflicts} headwinds — too many conflicts`);
  }

  if (gradeRank(confluence.grade) < playMinGradeRank()) {
    blocks.push(`Grade ${confluence.grade} below minimum (need A or A+)`);
  }

  const macro = macroHardBlock(desk);
  if (macro) blocks.push(macro);

  const etMins = etMinutes(new Date());
  if (etMins >= 14 * 60 + 30) {
    blocks.push("After 2:30 PM ET — no new 0DTE entries");
  }
  if (etMins < 7 * 60 + 0) {
    blocks.push("Before 7:00 AM ET — opening volatility, no entries");
  }

  if (abs < playWatchMinScore()) {
    blocks.push(`Score ${abs} too low — quality setups only`);
  }

  if (scoreBoost > 0) {
    warnings.push(`Adaptive score floor +${scoreBoost} (telemetry)`);
  }

  let entry_mode: PlayGateResult["entry_mode"] = "none";
  if (abs >= fullMin && confluence.conflicts <= 1) {
    entry_mode = "full";
  } else if (!playOnlyFullEntry() && abs >= playStarterMinScore() && confluence.conflicts <= 1) {
    entry_mode = "starter";
  }

  if (playOnlyFullEntry() && entry_mode === "starter") {
    entry_mode = "none";
    warnings.push("Starter size disabled — full A/A+ only");
  }

  const now = Date.now();
  if (session.last_buy_at && now - session.last_buy_at < playBuyCooldownSec() * 1000) {
    blocks.push(`Quality cooldown (${Math.round(playBuyCooldownSec() / 60)}m between plays)`);
  }

  if (
    session.last_sell_was_loss &&
    session.last_sell_at &&
    session.last_direction &&
    dir === session.last_direction &&
    now - session.last_sell_at < playReentryLockSec() * 1000
  ) {
    blocks.push(`Re-entry lock after loss (${Math.round(playReentryLockSec() / 60)}m)`);
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

  const passed = blocks.length === 0 && entry_mode === "full" && dir != null;

  return { passed, blocks, warnings, entry_mode };
}
