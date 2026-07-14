import "server-only";

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import type { SpxPlayDirection } from "@/features/spx/lib/spx-signals";
import { buildLottoOptionTicket } from "@/features/spx/lib/spx-lotto-options";
import { quoteSpxOdteContract, type OdteContractQuote } from "@/features/spx/lib/spx-play-options";
import { todayEt } from "@/lib/et-date";
import { round5 } from "@/lib/round5";
import { computeSpxConfluence } from "@/features/spx/lib/spx-signals";
import {
  LOTTO_SIZING_NOTE,
  playLottoConfirmMovePts,
  playLottoExpireEtHour,
  playLottoExpireEtMin,
  playLottoIntradayCutoffEtHour,
  playLottoIntradayCutoffEtMin,
  playLottoMaxPicksPerDay,
  playLottoMinScore,
  playLottoStopLossPts,
  playLottoTargetPts,
} from "@/features/spx/lib/spx-play-config";
import { evaluateLottoCatalysts } from "@/features/spx/lib/spx-lotto-catalyst";
import {
  clearLottoRecord,
  loadLottoRecord,
  saveLottoRecord,
  type LottoPhase,
  type LottoRecord,
} from "@/features/spx/lib/spx-lotto-store";
import { logLottoPhase, logLottoWatch } from "@/features/spx/lib/spx-lotto-outcomes";
import { notifyPlayDiscord } from "@/features/spx/lib/spx-play-notify";
import {
  isBeforeCashOpen,
  isPremarketPlanningWindow,
} from "@/features/spx/lib/spx-play-session-guards";
import { etClock, etMinutes } from "@/features/spx/lib/spx-play-session-time";
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
} from "@/features/spx/lib/spx-lotto-copy";

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
  option_bid: number | null;
  option_ask: number | null;
  option_mid: number | null;
};

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

/**
 * Intraday cutoff (default 2:00 PM ET) — after this no new scans or entries.
 * Distinct from the 10:30 AM opening-range expiry: the opening expiry kills unconfirmed
 * pre-market WATCHes, while this cutoff governs the wider intraday catalyst window.
 */
function isIntradayCutoff(now = new Date()): boolean {
  return etMinutes(now) >= etClock(playLottoIntradayCutoffEtHour(), playLottoIntradayCutoffEtMin());
}

/**
 * True only for WATCH records that were set up pre-market and have now passed 10:30 AM
 * without confirming entry. Intraday WATCH records (picked_at after 10:30) are exempt
 * from the opening-range expiry and remain active until the 2:00 PM intraday cutoff.
 */
function isOpeningWatchExpired(rec: LottoRecord, now: Date): boolean {
  if (!isLottoExpired(now)) return false;
  const expiryMins = etClock(playLottoExpireEtHour(), playLottoExpireEtMin());
  const pickedMins = rec.picked_at ? etMinutes(new Date(rec.picked_at)) : 0;
  return pickedMins < expiryMins;
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

function recordToPayload(rec: LottoRecord, quote?: OdteContractQuote | null): LottoPlayPayload {
  const premium = quote?.premium_display ?? rec.premium_estimate;
  return {
    phase: rec.phase,
    status_label: phaseLabel(rec.phase, rec.is_reversal),
    direction: rec.direction,
    strike: rec.strike,
    contract_label: rec.contract_label,
    premium_estimate: premium,
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
    spread_pct: quote?.spread_pct ?? rec.spread_pct,
    open_anchor_price: rec.open_anchor_price,
    option_bid: quote?.bid ?? null,
    option_ask: quote?.ask ?? null,
    option_mid: quote?.mid ?? null,
  };
}

async function liveQuoteForLotto(rec: LottoRecord): Promise<OdteContractQuote | null> {
  if (!rec.strike || !rec.direction) return null;
  if (rec.phase !== "HOLD" && rec.phase !== "WATCH" && rec.phase !== "BUY") return null;
  try {
    return await quoteSpxOdteContract(rec.strike, rec.direction === "long" ? "call" : "put");
  } catch {
    return null;
  }
}

async function recordToPayloadAsync(rec: LottoRecord): Promise<LottoPlayPayload> {
  return recordToPayload(rec, await liveQuoteForLotto(rec));
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
    option_bid: null,
    option_ask: null,
    option_mid: null,
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
  const isIntraday =
    !isReversal &&
    etMinutes(new Date()) >= etClock(playLottoExpireEtHour(), playLottoExpireEtMin());
  const anchorLabel = isReversal
    ? "reversal anchor (SPX at invalidation)"
    : isIntraday
      ? "intraday anchor (SPX at setup time)"
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
        ? `Pre-BUY: −${confirmPts}pt from ${anchorLabel} invalidates (no entry)`
        : `Pre-BUY: +${confirmPts}pt from ${anchorLabel} invalidates (no entry)`,
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

  // Price move is the primary gate. Technical confirmation (5m trend / level break)
  // improves quality when Polygon candle data is available, but is not a hard gate
  // when it's down — a confirmed price move IS a real signal regardless of candle state.
  const techGate = !technicals?.available || Boolean(candleOk);
  return moveOk && techGate;
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

  if (pnl <= -playLottoStopLossPts()) return "stop";
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
  const ticket = await buildLottoOptionTicket(price, catalyst.direction, desk.vix ?? null);
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

  let rec = await loadLottoRecord();

  // L-1: Full intraday cutoff at 2:00 PM — no new entries or scans after this point.
  // HOLD is always exempt: active positions must continue to be evaluated for exit.
  // Note: the 10:30 AM opening-range expiry is handled separately inside the WATCH block,
  // where opening WATCHes that never confirmed are downgraded to NONE for intraday scanning.
  if (isIntradayCutoff(now) && rec?.phase !== "HOLD") {
    if (rec?.phase === "WATCH" || rec?.phase === "NONE") {
      await clearLottoRecord();
    }
    return nonePayload("expired");
  }

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
      // L-2/L-6: await SELL log so outcome is durable before follow-up or state transition.
      try {
        await logLottoPhase(rec, {
          phase: "SELL",
          outcome: "win",
          exit_price: desk.price,
          closed_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error("[spx-lotto-engine] logLottoPhase(win) failed:", err);
      }
      const pnlPts = rec.entry_price != null ? Math.abs(desk.price - rec.entry_price) : rec.target_pts;
      void notifyPlayDiscord({
        action: "SELL",
        direction: rec.direction,
        headline: `✅ LOTTO WIN: ${rec.contract_label} +${pnlPts.toFixed(0)}pts`,
        price: desk.price,
      });

      const prev = rec.pick_count;
      if (prev < playLottoMaxPicksPerDay()) {
        const followUp = await tryNewWatch(desk, prev + 1, false);
        if (followUp) {
          await saveLottoRecord(followUp);
          void logLottoWatch(followUp);
          return recordToPayloadAsync(followUp);
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
      return recordToPayloadAsync(rec);
    }
    if (exit === "stop") {
      // L-6: await SELL log so outcome is durable. Still clear state even if logging fails.
      try {
        await logLottoPhase(rec, {
          phase: "SELL",
          outcome: "stop",
          exit_price: desk.price,
          closed_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error("[spx-lotto-engine] logLottoPhase(stop) failed:", err);
      }
      const lossPts = rec.entry_price != null ? Math.abs(desk.price - rec.entry_price) : playLottoConfirmMovePts();
      void notifyPlayDiscord({
        action: "SELL",
        direction: rec.direction,
        headline: `🔴 LOTTO STOP: ${rec.contract_label} -${lossPts.toFixed(0)}pts`,
        price: desk.price,
      });
      await clearLottoRecord();
      return nonePayload("stopped");
    }
    return recordToPayloadAsync(rec);
  }

  if (rec?.phase === "WATCH" && afterCash) {
    if (isOpeningWatchExpired(rec, now)) {
      // Pre-market WATCH didn't confirm by 10:30 AM — transition to NONE so the
      // intraday catalyst scan (up to 2 PM) can take over the same pick slot.
      // Decrement pick_count so the intraday scan treats this as the same pick number
      // (the opening WATCH never entered, so it doesn't consume a pick).
      rec = { ...rec, phase: "NONE", pick_count: Math.max(0, rec.pick_count - 1) };
      await saveLottoRecord(rec);
      // Fall through to NONE scan block below.
    } else {
      // Still an active WATCH (opening window not yet expired, or intraday WATCH) —
      // check for entry confirmation or invalidation as normal.
      if (openConfirm(rec, desk, technicals)) {
        const buyAt = new Date().toISOString();
        // Write directly to HOLD — skip intermediate BUY write to prevent a crash
        // between the two saves from leaving the lotto permanently stuck in BUY phase.
        rec = {
          ...rec,
          phase: "HOLD",
          entry_price: desk.price,
          buy_at: buyAt,
          peak_pnl_pts: 0,
          status_message: lottoHoldStatusMessage(),
        };
        await saveLottoRecord(rec);
        // Await both log writes sequentially — these populate the outcomes table for
        // win-rate analytics; fire-and-forget would silently drop records on DB errors.
        try {
          await logLottoPhase(rec, { phase: "BUY", entry_price: desk.price, buy_at: buyAt });
          await logLottoPhase(rec, { phase: "HOLD", entry_price: desk.price });
        } catch (err) {
          console.error("[spx-lotto-engine] logLottoPhase(BUY/HOLD) failed:", err);
        }
        // N-1: Notify Discord on WATCH→HOLD (open/buy).
        void notifyPlayDiscord({
          action: "BUY",
          direction: rec.direction,
          headline: `🎰 LOTTO BUY: ${rec.contract_label} @ ~${rec.premium_estimate ?? "—"}`,
          price: desk.price,
        });
        return recordToPayloadAsync(rec);
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
        return recordToPayloadAsync(reversal);
      }

      return recordToPayloadAsync(rec);
    }
    // Opening WATCH expired → rec is now NONE → fall through to NONE scan below.
  }

  if (rec?.phase === "WATCH" && premarket) {
    return recordToPayloadAsync(rec);
  }

  if (rec?.phase === "NONE" && afterCash && !premarket) {
    // Opening-range expiry (10:30 AM) is handled in the WATCH block above.
    // The NONE scan uses the wider 2:00 PM intraday cutoff so catalyst plays
    // can be established throughout the morning/midday session.
    if (rec.pick_count >= playLottoMaxPicksPerDay()) {
      return nonePayload("closed_for_today");
    }
    const candidate = await tryNewWatch(desk, rec.pick_count + 1, false);
    if (!candidate) {
      return nonePayload("no_qualify");
    }
    await saveLottoRecord(candidate);
    void logLottoWatch(candidate);
    return recordToPayloadAsync(candidate);
  }

  if (!rec || rec.phase === "INVALID" || rec.phase === "SELL") {
    // SELL = picks exhausted for today — never re-enter regardless of time window.
    if (rec?.phase === "SELL") return nonePayload("closed_for_today");
    // Allow fresh scans during both pre-market AND the intraday window (until 2 PM).
    const inIntradayWindow = afterCash && !premarket;
    if (!premarket && !inIntradayWindow) {
      return nonePayload("no_qualify");
    }
    const candidate = await tryNewWatch(desk, rec?.pick_count ?? 1, false);
    if (!candidate) {
      return nonePayload("no_qualify");
    }
    await saveLottoRecord(candidate);
    void logLottoWatch(candidate);
    return recordToPayloadAsync(candidate);
  }

  return rec ? recordToPayloadAsync(rec) : nonePayload("no_qualify");
}

/**
 * Read-only lotto projection — NO saves, clears, lotto_plays writes, or Discord.
 * Mirrors evaluateSpxLotto's RENDER classification only; advancing state happens only
 * via the spx-evaluate cron or the admin dashboard's explicit-confirm mutate path
 * (admin-spx-dashboard.ts), both funneled through the same runLottoPowerHourLocked
 * advisory lock so they can't double-mutate. Every other read path (public/admin poll)
 * calls this so it can never mutate shared state or fire duplicate subscriber alerts
 * (audit P1).
 */
export async function readSpxLottoSnapshot(): Promise<LottoPlayPayload> {
  const now = new Date();
  const premarket = isPremarketPlanningWindow(now);
  const beforeCash = isBeforeCashOpen(now);
  if (!premarket && beforeCash) return nonePayload("off_hours");

  const rec = await loadLottoRecord();
  if (!rec) return nonePayload("no_qualify");
  if (isIntradayCutoff(now) && rec.phase !== "HOLD") return nonePayload("expired");
  if (rec.phase === "WATCH" && !beforeCash && isOpeningWatchExpired(rec, now)) {
    return nonePayload("expired");
  }
  if (rec.phase === "SELL") return nonePayload("closed_for_today");
  // NONE/INVALID render as the friendly "no setup" copy (the engine never renders a
  // NONE record through recordToPayload — it falls through to a scan/nonePayload).
  if (rec.phase === "INVALID" || rec.phase === "NONE") return nonePayload("no_qualify");
  // HOLD, active WATCH, or premarket WATCH → render the stored record verbatim.
  return recordToPayloadAsync(rec);
}

/** @deprecated Lotto is independent — no-op for main BUY path. */
export async function consumeLottoOnBuy(_direction: SpxPlayDirection): Promise<void> {
  return;
}

/** Back-compat alias */
export const evaluateLottoPlay = evaluateSpxLotto;
