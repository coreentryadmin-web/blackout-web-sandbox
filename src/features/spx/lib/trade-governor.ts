import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import {
  liveDataQualityMode,
  playbookDataQualityFlags,
  shouldFailClosedLiveOnDataQuality,
} from "@/features/spx/lib/playbook-data-quality";
import {
  playbookDegradedSizeMultiplier,
  playbookSessionMaxTriggersPerPb,
} from "@/features/spx/lib/playbook-session-risk";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import {
  playBuyCooldownSec,
  playCooldownAfterStopMin,
  playReentryLockSec,
  playSessionMaxEntries,
  playSessionMaxLosses,
  playbookStagingLabEnabled,
} from "@/features/spx/lib/spx-play-config";

export type TradeGovernorTier = "normal" | "reduced" | "halt";

export type TradeGovernorInput = {
  buy_intent: boolean;
  playbook_id: PlaybookId | null;
  direction: "long" | "short" | null;
  desk: SpxDeskPayload;
  session: {
    last_buy_at: number | null;
    last_sell_at: number | null;
    last_sell_was_loss: boolean;
    last_direction: "long" | "short" | null;
    last_stop_at: number | null;
    session_entries_today?: number;
    session_losses_today?: number;
  };
  triggers_today_by_pb?: ReadonlyMap<string, number>;
  option?: {
    mid: number | null;
    spread_pct: number | null;
    blocked?: boolean;
    block_reason?: string | null;
  };
  /** A+ bypass for buy cooldown (legacy gate behavior). */
  bypass_buy_cooldown?: boolean;
};

export type TradeGovernorResult = {
  blocks: string[];
  warnings: string[];
  size_multiplier: number;
  tier: TradeGovernorTier;
  emergency_shutdown: boolean;
};

function maxSpreadPct(): number {
  const n = Number(process.env.TRADE_GOVERNOR_MAX_SPREAD_PCT ?? "18");
  return Number.isFinite(n) && n > 0 ? n : 18;
}

function maxPremiumUsd(): number {
  const n = Number(process.env.TRADE_GOVERNOR_MAX_PREMIUM_USD ?? "12");
  return Number.isFinite(n) && n > 0 ? n : 12;
}

function maxConsecutiveLosses(): number {
  const n = Number(process.env.TRADE_GOVERNOR_MAX_CONSECUTIVE_LOSSES ?? "3");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

/**
 * Session-level risk subsystem — independent of individual playbook matchers.
 * Called from gates on BUY intent after playbook validity checks.
 */
export function evaluateTradeGovernor(input: TradeGovernorInput): TradeGovernorResult {
  const blocks: string[] = [];
  const warnings: string[] = [];
  let size_multiplier = 1;
  let tier: TradeGovernorTier = "normal";
  let emergency_shutdown = false;

  if (!input.buy_intent) {
    return { blocks, warnings, size_multiplier, tier, emergency_shutdown };
  }

  const entriesToday = input.session.session_entries_today ?? 0;
  const lossesToday = input.session.session_losses_today ?? 0;
  const maxEntries = playSessionMaxEntries();
  const maxLosses = playSessionMaxLosses();

  if (entriesToday >= maxEntries) {
    blocks.push(`Session entry cap (${maxEntries}) — stand down for today`);
    tier = "halt";
  }

  if (lossesToday >= maxLosses) {
    blocks.push(`Session loss cap (${maxLosses}) — revenge-trading lockout`);
    tier = "halt";
    emergency_shutdown = true;
  }

  if (lossesToday >= maxConsecutiveLosses()) {
    warnings.push(`Consecutive loss watch (${lossesToday}/${maxConsecutiveLosses()})`);
    size_multiplier = Math.min(size_multiplier, 0.5);
    if (tier === "normal") tier = "reduced";
  }

  const now = Date.now();
  if (
    input.session.last_sell_was_loss &&
    input.session.last_sell_at &&
    input.direction &&
    input.session.last_direction === input.direction &&
    now - input.session.last_sell_at < playReentryLockSec() * 1000
  ) {
    blocks.push(
      `Re-entry lock after loss (${Math.round(playReentryLockSec() / 60)}m same direction)`
    );
  }

  if (input.session.last_stop_at) {
    const stopCooldownMs = playCooldownAfterStopMin() * 60_000;
    if (now - input.session.last_stop_at < stopCooldownMs) {
      blocks.push(`Post-stop cooldown (${playCooldownAfterStopMin()}m)`);
    }
  }

  if (input.session.last_buy_at && now - input.session.last_buy_at < playBuyCooldownSec() * 1000) {
    if (!input.bypass_buy_cooldown) {
      blocks.push(`Buy cooldown (${playBuyCooldownSec()}s)`);
    }
  }

  if (
    input.session.last_sell_at &&
    now - input.session.last_sell_at < playBuyCooldownSec() * 1000 &&
    !input.bypass_buy_cooldown
  ) {
    blocks.push(
      `Buy cooldown (${Math.round(playBuyCooldownSec() / 60)}m after exit)`
    );
  }

  if (input.playbook_id) {
    const count = input.triggers_today_by_pb?.get(input.playbook_id) ?? 0;
    const max = playbookSessionMaxTriggersPerPb();
    if (count >= max) {
      blocks.push(`Playbook ${input.playbook_id} session trigger cap (${max})`);
      tier = "halt";
    }
  }

  if (playbookStagingLabEnabled()) {
    const dq = playbookDataQualityFlags(input.desk);
    const mode = liveDataQualityMode(dq);
    if (shouldFailClosedLiveOnDataQuality(mode)) {
      blocks.push(`Trade governor: severe data quality (${mode}) — fail-closed`);
      tier = "halt";
      emergency_shutdown = true;
    } else if (mode === "degraded") {
      size_multiplier = Math.min(size_multiplier, playbookDegradedSizeMultiplier());
      tier = tier === "halt" ? "halt" : "reduced";
      warnings.push(`Degraded feeds — size ×${size_multiplier}`);
    }
  }

  if (input.desk.vix != null && input.desk.vix > 32) {
    blocks.push(`VIX ${input.desk.vix.toFixed(1)} — governor blocks new 0DTE entries`);
    tier = "halt";
  } else if (input.desk.vix != null && input.desk.vix > 28) {
    warnings.push(`Elevated VIX ${input.desk.vix.toFixed(1)}`);
    size_multiplier = Math.min(size_multiplier, 0.75);
    if (tier === "normal") tier = "reduced";
  }

  const opt = input.option;
  if (opt?.blocked && opt.block_reason) {
    blocks.push(`Option contract blocked — ${opt.block_reason}`);
  }
  if (opt?.spread_pct != null && opt.spread_pct > maxSpreadPct()) {
    blocks.push(`Spread ${opt.spread_pct.toFixed(0)}% > governor max ${maxSpreadPct()}%`);
  }
  if (opt?.mid != null && opt.mid > maxPremiumUsd()) {
    blocks.push(`Premium $${opt.mid.toFixed(2)} > governor max $${maxPremiumUsd()}`);
  }

  return { blocks, warnings, size_multiplier, tier, emergency_shutdown };
}
