import type { SpxConfluence } from "@/lib/spx-signals";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import {
  playBuyCooldownSec,
  playConflictBlockMin,
  playFullMinScore,
  playGexStaleMaxSec,
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
  }
): PlayGateResult {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const abs = Math.abs(confluence.score);
  const dir = confluence.bias === "bullish" ? "long" : confluence.bias === "bearish" ? "short" : null;

  if (!desk.market_open) {
    blocks.push("Session closed — no new entries");
  }

  if (desk.gex_walls.length === 0) {
    warnings.push("GEX walls empty — using structure levels only");
  }

  const polledAt = desk.polled_at ?? desk.as_of;
  if (polledAt) {
    const ageSec = (Date.now() - new Date(polledAt).getTime()) / 1000;
    if (ageSec > playGexStaleMaxSec()) {
      blocks.push(`Desk data stale (${Math.round(ageSec)}s > ${playGexStaleMaxSec()}s)`);
    }
  }

  if (confluence.conflicts >= playConflictBlockMin()) {
    blocks.push(`${confluence.conflicts} headwinds — conflicts block entry`);
  }

  const macro = macroHardBlock(desk);
  if (macro) blocks.push(macro);

  const etMins = etMinutes(new Date());
  if (etMins >= 14 * 60 + 30) {
    blocks.push("After 2:30 PM ET — no new 0DTE entries");
  }

  if (abs < playWatchMinScore()) {
    blocks.push(`Score ${abs} below watch minimum (${playWatchMinScore()})`);
  }

  let entry_mode: PlayGateResult["entry_mode"] = "none";
  if (abs >= playFullMinScore() && confluence.conflicts <= 1) {
    entry_mode = "full";
  } else if (abs >= playStarterMinScore() && confluence.conflicts <= 2) {
    entry_mode = "starter";
  } else if (abs >= playWatchMinScore()) {
    entry_mode = "none";
    if (!blocks.some((b) => b.includes("headwinds"))) {
      warnings.push("Watch band only — awaiting full entry score");
    }
  }

  const now = Date.now();
  if (session.last_buy_at && now - session.last_buy_at < playBuyCooldownSec() * 1000) {
    blocks.push(`Buy cooldown (${playBuyCooldownSec()}s)`);
  }

  if (
    session.last_sell_was_loss &&
    session.last_sell_at &&
    session.last_direction &&
    dir === session.last_direction &&
    now - session.last_sell_at < playReentryLockSec() * 1000
  ) {
    blocks.push(`Re-entry lock after loss (${playReentryLockSec()}s)`);
  }

  if (desk.vix != null && desk.vix > 28) {
    warnings.push(`Elevated VIX ${desk.vix.toFixed(1)} — size down`);
  }

  const agreeing =
    confluence.bias === "bullish"
      ? confluence.factors.filter((f) => f.weight > 0).length
      : confluence.bias === "bearish"
        ? confluence.factors.filter((f) => f.weight < 0).length
        : 0;
  if (entry_mode !== "none" && agreeing < 4) {
    blocks.push(`Only ${agreeing}/4+ factors agree — need more confluence`);
    entry_mode = "none";
  }

  const passed = blocks.length === 0 && entry_mode !== "none" && dir != null;

  return { passed, blocks, warnings, entry_mode };
}
