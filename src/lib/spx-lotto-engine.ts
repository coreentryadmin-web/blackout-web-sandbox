import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { PlayTechnicals } from "@/lib/spx-play-technicals";
import type { SpxPlayDirection } from "@/lib/spx-signals";
import { buildLottoOptionTicket } from "@/lib/spx-lotto-options";
import { computeSpxConfluence } from "@/lib/spx-signals";
import {
  LOTTO_SIZING_NOTE,
  playLottoConfirmMovePts,
  playLottoExpireEtHour,
  playLottoExpireEtMin,
  playLottoMaxPicksPerDay,
  playLottoMinScore,
  playLottoTargetPts,
} from "@/lib/spx-play-config";
import { evaluateLottoCatalysts } from "@/lib/spx-lotto-catalyst";
import {
  clearLottoRecord,
  loadLottoRecord,
  saveLottoRecord,
  type LottoPhase,
  type LottoRecord,
} from "@/lib/spx-lotto-store";
import { logLottoPhase, logLottoWatch } from "@/lib/spx-lotto-outcomes";
import {
  isBeforeCashOpen,
  isPremarketPlanningWindow,
} from "@/lib/spx-play-session-guards";
import { etClock, etMinutes } from "@/lib/spx-play-session-time";
import {
  lottoBuyStatusMessage,
  lottoHoldStatusMessage,
  lottoNoneCopy,
  lottoPhaseKicker,
  lottoWatchHeadline,
  lottoWatchStatusMessage,
  lottoWatchThesis,
  lottoWinStatusMessage,
  type LottoNoneReason,
} from "@/lib/spx-lotto-copy";

export type LottoPlayPayload = {
  phase: LottoPhase;
  status_label: string;
  direction: SpxPlayDirection | null;
  strike: number | null;
  contract_label: string | null;
  premium_estimate: string | null;
  entry_zone: number | null;
  entry_trigger: string | null;
  target_price: number | null;
  target_pts: number;
  invalidation: string | null;
  catalyst_summary: string | null;
  catalysts: string[];
  confidence: number;
  headline: string;
  thesis: string;
  status_message: string;
  /** @deprecated use phase */
  status: "watching" | "ready" | "invalidated" | "none";
  drivers: string[];
  footnote: string | null;
  flow_summary: string | null;
  sizing_note: string;
  spread_pct: number | null;
  open_anchor_price: number | null;
};

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

/** Lotto target: minimum ±25 SPX pts, extended to the next structure level when farther. */
function resolveLottoTargetPts(
  desk: SpxDeskPayload,
  direction: SpxPlayDirection,
  entry: number
): number {
  const min = playLottoTargetPts();
  if (entry <= 0) return min;

  if (direction === "long") {
    const levels = [
      ...(desk.gex_walls ?? [])
        .filter((w) => w.kind === "resistance" && w.strike > entry)
        .map((w) => w.strike),
      desk.hod,
      desk.pdh,
      desk.max_pain,
    ].filter((v): v is number => v != null && v > entry);
    if (levels.length) {
      return Math.max(min, Math.min(...levels) - entry);
    }
    return min;
  }

  const levels = [
    ...(desk.gex_walls ?? [])
      .filter((w) => w.kind === "support" && w.strike < entry)
      .map((w) => w.strike),
    desk.lod,
    desk.pdl,
    desk.max_pain,
  ].filter((v): v is number => v != null && v < entry);
  if (levels.length) {
    return Math.max(min, entry - Math.max(...levels));
  }
  return min;
}

function isLottoExpired(now = new Date()): boolean {
  return etMinutes(now) >= etClock(playLottoExpireEtHour(), playLottoExpireEtMin());
}

function phaseLabel(phase: LottoPhase, isReversal = false): string {
  return lottoPhaseKicker(phase, isReversal);
}

function legacyStatus(phase: LottoPhase): LottoPlayPayload["status"] {
  if (phase === "WATCH" || phase === "SCAN") return "watching";
  if (phase === "BUY" || phase === "HOLD") return "ready";
  if (phase === "INVALID") return "invalidated";
  return "none";
}

function flowSummary(catalysts: string[]): string | null {
  const flow = catalysts.find((c) => /flow|call-led|put-led|\$[\d.]+M/i.test(c));
  return flow ?? null;
}

function recordToPayload(rec: LottoRecord): LottoPlayPayload {
  return {
    phase: rec.phase,
    status_label: phaseLabel(rec.phase, rec.is_reversal),
    direction: rec.direction,
    strike: rec.strike,
    contract_label: rec.contract_label,
    premium_estimate: rec.premium_estimate,
    entry_zone: rec.entry_zone,
    entry_trigger: rec.entry_trigger,
    target_price: rec.target_price,
    target_pts: rec.target_pts,
    invalidation: rec.invalidation_note,
    catalyst_summary: rec.catalyst_summary,
    catalysts: rec.catalysts,
    confidence: rec.confidence,
    headline: rec.headline,
    thesis: rec.thesis,
    status_message: rec.status_message,
    status: legacyStatus(rec.phase),
    drivers: rec.catalysts,
    footnote: rec.status_message,
    flow_summary: flowSummary(rec.catalysts),
    sizing_note: LOTTO_SIZING_NOTE,
    spread_pct: rec.spread_pct,
    open_anchor_price: rec.open_anchor_price,
  };
}

function nonePayload(reason: LottoNoneReason): LottoPlayPayload {
  const copy = lottoNoneCopy(reason);
  return {
    phase: "NONE",
    status_label: copy.kicker,
    direction: null,
    strike: null,
    contract_label: null,
    premium_estimate: null,
    entry_zone: null,
    entry_trigger: null,
    target_price: null,
    target_pts: playLottoTargetPts(),
    invalidation: null,
    catalyst_summary: null,
    catalysts: [],
    confidence: 0,
    headline: copy.headline,
    thesis: copy.thesis,
    status_message: copy.footnote ?? copy.thesis,
    status: "none",
    drivers: [],
    footnote: copy.footnote ?? null,
    flow_summary: null,
    sizing_note: LOTTO_SIZING_NOTE,
    spread_pct: null,
    open_anchor_price: null,
  };
}

function buildWatchRecord(
  desk: SpxDeskPayload,
  direction: SpxPlayDirection,
  catalyst: ReturnType<typeof evaluateLottoCatalysts>,
  pickCount: number,
  isReversal: boolean,
  ticket: Awaited<ReturnType<typeof buildLottoOptionTicket>>
): LottoRecord | null {
  const price = desk.price > 0 ? desk.price : desk.prior_close ?? desk.pdh ?? 0;
  if (price <= 0) return null;

  const entryZone = round5(price);
  const targetPts = resolveLottoTargetPts(desk, direction, entryZone);
  const targetPrice = direction === "long" ? round5(entryZone + targetPts) : round5(entryZone - targetPts);
  const strike = ticket.strike;
  const contractLabel = ticket.contract_label || `${strike}${direction === "long" ? "C" : "P"}`;
  const invalidationLevel =
    direction === "long"
      ? round5(Math.min(desk.pdl ?? entryZone - playLottoConfirmMovePts(), entryZone - playLottoConfirmMovePts()))
      : round5(Math.max(desk.pdh ?? entryZone + playLottoConfirmMovePts(), entryZone + playLottoConfirmMovePts()));

  const confirmPts = playLottoConfirmMovePts();
  const anchorLabel = isReversal
    ? "reversal anchor (SPX at invalidation)"
    : "9:30 open anchor (first cash print)";
  const entryTrigger =
    direction === "long"
      ? `+${confirmPts}pt from ${anchorLabel}`
      : `−${confirmPts}pt from ${anchorLabel}`;

  const headline = lottoWatchHeadline(direction, strike, targetPts, isReversal);
  const thesis = lottoWatchThesis(catalyst.catalyst_summary, isReversal);

  return {
    session_date: todayEt(),
    phase: "WATCH",
    direction,
    strike,
    contract_label: contractLabel,
    premium_estimate: ticket.premium_range,
    entry_zone: entryZone,
    entry_trigger: entryTrigger,
    target_price: targetPrice,
    target_pts: targetPts,
    invalidation_level: invalidationLevel,
    invalidation_note:
      direction === "long"
        ? `Pre-BUY: −${confirmPts}pt from 9:30 open anchor invalidates (no entry)`
        : `Pre-BUY: +${confirmPts}pt from 9:30 open anchor invalidates (no entry)`,
    catalyst_summary: catalyst.catalyst_summary,
    catalysts: catalyst.catalysts.map((c) => c.label),
    confidence: catalyst.confidence,
    headline,
    thesis,
    status_message: lottoWatchStatusMessage(isReversal, ticket.blocked, ticket.block_reason),
    open_anchor_price: null,
    entry_price: null,
    peak_pnl_pts: null,
    picked_at: new Date().toISOString(),
    buy_at: null,
    pick_count: pickCount,
    is_reversal: isReversal,
    catalyst_snapshot: {
      gap_pct: desk.gap_pct,
      flow_net: desk.flow_0dte_net,
      vix_term: desk.vix_term,
      macro: desk.macro_events?.slice(0, 3),
    },
    spread_pct: ticket.spread_pct,
  };
}

/** Placeholder after a win when follow-up catalyst isn't ready — keeps pick slot alive. */
function buildPickSlotAwaitingRecord(completedPicks: number): LottoRecord {
  return {
    session_date: todayEt(),
    phase: "NONE",
    direction: "long",
    strike: 0,
    contract_label: "",
    premium_estimate: null,
    spread_pct: null,
    entry_zone: 0,
    entry_trigger: "",
    target_price: 0,
    target_pts: playLottoTargetPts(),
    invalidation_level: 0,
    invalidation_note: "",
    catalyst_summary: "",
    catalysts: [],
    confidence: 0,
    headline: "Awaiting follow-up lotto setup",
    thesis: "Prior pick won — scanning for next catalyst",
    status_message: lottoWinStatusMessage(playLottoTargetPts()) + " · scanning for follow-up",
    open_anchor_price: null,
    entry_price: null,
    peak_pnl_pts: null,
    picked_at: new Date().toISOString(),
    buy_at: null,
    pick_count: completedPicks,
    is_reversal: false,
    catalyst_snapshot: {},
  };
}

function openConfirm(
  rec: LottoRecord,
  desk: SpxDeskPayload,
  technicals: PlayTechnicals | null
): boolean {
  const anchor = rec.open_anchor_price ?? desk.price;
  if (anchor <= 0 || desk.price <= 0) return false;

  const move = desk.price - anchor;
  const moveOk =
    rec.direction === "long"
      ? move >= playLottoConfirmMovePts()
      : move <= -playLottoConfirmMovePts();

  const candleOk =
    technicals?.available &&
    (rec.direction === "long"
      ? technicals.m5_trend === "up" || technicals.breakout.pdh_break
      : technicals.m5_trend === "down" || technicals.breakout.pdl_break);

  return moveOk && Boolean(candleOk);
}

function openInvalidate(
  rec: LottoRecord,
  desk: SpxDeskPayload,
  technicals: PlayTechnicals | null
): boolean {
  const anchor = rec.open_anchor_price ?? desk.price;
  if (anchor <= 0 || desk.price <= 0) return false;

  const move = desk.price - anchor;
  const against =
    rec.direction === "long"
      ? move <= -playLottoConfirmMovePts()
      : move >= playLottoConfirmMovePts();

  const candleAgainst =
    technicals?.available &&
    (rec.direction === "long"
      ? technicals.m5_trend === "down" && technicals.breakout.pdl_break
      : technicals.m5_trend === "up" && technicals.breakout.pdh_break);

  const levelBreak =
    rec.direction === "long"
      ? desk.price < rec.invalidation_level
      : desk.price > rec.invalidation_level;

  return against || Boolean(candleAgainst) || levelBreak;
}

function holdExit(
  rec: LottoRecord,
  desk: SpxDeskPayload
): "win" | "stop" | null {
  if (rec.entry_price == null || desk.price <= 0) return null;
  const pnl = rec.direction === "long" ? desk.price - rec.entry_price : rec.entry_price - desk.price;
  if (pnl >= rec.target_pts) return "win";

  const trailTrigger = rec.target_pts * 0.6;
  const peak = rec.peak_pnl_pts ?? pnl;

  if (peak >= trailTrigger) {
    if (pnl <= 0) return "stop";
    if (pnl <= peak * 0.4) return "stop";
    return null;
  }

  if (pnl <= -playLottoConfirmMovePts()) return "stop";
  return null;
}

async function tryNewWatch(
  desk: SpxDeskPayload,
  pickCount: number,
  isReversal: boolean
): Promise<LottoRecord | null> {
  const catalyst = evaluateLottoCatalysts(desk);
  if (!catalyst.qualified || !catalyst.direction) return null;

  const confluence = computeSpxConfluence(desk);
  const minScore = playLottoMinScore();
  if (confluence && Math.abs(confluence.score) < minScore) return null;

  const price = desk.price > 0 ? desk.price : desk.prior_close ?? desk.pdh ?? 0;
  const ticket = await buildLottoOptionTicket(price, catalyst.direction);
  return buildWatchRecord(desk, catalyst.direction, catalyst, pickCount, isReversal, ticket);
}

/**
 * Parallel pre-market lotto track — does NOT affect the main SPX play state machine.
 */
export async function evaluateSpxLotto(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals | null
): Promise<LottoPlayPayload> {
  const now = new Date();
  const premarket = isPremarketPlanningWindow(now);
  const beforeCash = isBeforeCashOpen(now);
  const afterCash = !beforeCash;

  if (!premarket && beforeCash) {
    return nonePayload("off_hours");
  }

  if (isLottoExpired(now) && beforeCash) {
    return nonePayload("off_hours");
  }

  let rec = await loadLottoRecord();

  if (rec && rec.phase === "WATCH" && afterCash && rec.open_anchor_price == null && desk.price > 0) {
    // Open anchor = first valid SPX cash print at or after 9:30 AM ET.
    rec = { ...rec, open_anchor_price: desk.price };
    await saveLottoRecord(rec);
  }

  if (rec?.phase === "HOLD") {
    const pnl =
      rec.entry_price != null && desk.price > 0
        ? rec.direction === "long"
          ? desk.price - rec.entry_price
          : rec.entry_price - desk.price
        : null;
    if (pnl != null) {
      const peak = Math.max(rec.peak_pnl_pts ?? pnl, pnl);
      if (peak !== rec.peak_pnl_pts) {
        rec = { ...rec, peak_pnl_pts: peak };
        await saveLottoRecord(rec);
      }
    }

    const exit = holdExit(rec, desk);
    if (exit === "win") {
      void logLottoPhase(rec, {
        phase: "SELL",
        outcome: "win",
        exit_price: desk.price,
        closed_at: new Date().toISOString(),
      });

      const prev = rec.pick_count;
      if (prev < playLottoMaxPicksPerDay()) {
        const followUp = await tryNewWatch(desk, prev + 1, false);
        if (followUp) {
          await saveLottoRecord(followUp);
          void logLottoWatch(followUp);
          return recordToPayload(followUp);
        }
        await saveLottoRecord(buildPickSlotAwaitingRecord(prev));
        return nonePayload("no_qualify");
      }

      rec = {
        ...rec,
        phase: "SELL",
        status_message: lottoWinStatusMessage(rec.target_pts),
      };
      await saveLottoRecord(rec);
      return recordToPayload(rec);
    }
    if (exit === "stop") {
      void logLottoPhase(rec, {
        phase: "SELL",
        outcome: "stop",
        exit_price: desk.price,
        closed_at: new Date().toISOString(),
      });
      await clearLottoRecord();
      return nonePayload("stopped");
    }
    return recordToPayload(rec);
  }

  if (rec?.phase === "WATCH" && afterCash) {
    if (isLottoExpired(now)) {
      await clearLottoRecord();
      return nonePayload("expired");
    }

    if (openConfirm(rec, desk, technicals)) {
      const bought: LottoRecord = {
        ...rec,
        phase: "BUY",
        entry_price: desk.price,
        buy_at: new Date().toISOString(),
        status_message: lottoBuyStatusMessage(),
      };
      await saveLottoRecord(bought);
      void logLottoPhase(bought, {
        phase: "BUY",
        entry_price: desk.price,
        buy_at: bought.buy_at,
      });
      rec = { ...bought, phase: "HOLD", peak_pnl_pts: 0, status_message: lottoHoldStatusMessage() };
      await saveLottoRecord(rec);
      void logLottoPhase(rec, { phase: "HOLD", entry_price: desk.price });
      return recordToPayload(rec);
    }

    if (openInvalidate(rec, desk, technicals)) {
      const prev = rec.pick_count;
      await clearLottoRecord();
      if (prev >= playLottoMaxPicksPerDay()) {
        return nonePayload("max_picks");
      }
      const reversal = await tryNewWatch(desk, prev + 1, true);
      if (!reversal) return nonePayload("invalidated_no_reversal");
      await saveLottoRecord(reversal);
      void logLottoWatch(reversal);
      return recordToPayload(reversal);
    }

    return recordToPayload(rec);
  }

  if (rec?.phase === "WATCH" && premarket) {
    return recordToPayload(rec);
  }

  if (rec?.phase === "NONE" && afterCash && !premarket) {
    if (isLottoExpired(now)) {
      await clearLottoRecord();
      return nonePayload("expired");
    }
    if (rec.pick_count >= playLottoMaxPicksPerDay()) {
      return nonePayload("closed_for_today");
    }
    const candidate = await tryNewWatch(desk, rec.pick_count + 1, false);
    if (!candidate) {
      return nonePayload("no_qualify");
    }
    await saveLottoRecord(candidate);
    void logLottoWatch(candidate);
    return recordToPayload(candidate);
  }

  if (!rec || rec.phase === "INVALID" || rec.phase === "SELL") {
    if (!premarket) {
      return nonePayload(rec?.phase === "SELL" ? "closed_for_today" : "no_qualify");
    }
    const candidate = await tryNewWatch(desk, 1, false);
    if (!candidate) {
      return nonePayload("no_qualify");
    }
    await saveLottoRecord(candidate);
    void logLottoWatch(candidate);
    return recordToPayload(candidate);
  }

  return rec ? recordToPayload(rec) : nonePayload("no_qualify");
}

/** @deprecated Lotto is independent — no-op for main BUY path. */
export async function consumeLottoOnBuy(_direction: SpxPlayDirection): Promise<void> {
  return;
}

/** Back-compat alias */
export const evaluateLottoPlay = evaluateSpxLotto;
