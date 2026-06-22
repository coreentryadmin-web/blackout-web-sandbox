/**
 * Power Hour Lotto Engine — 2:45–3:15 PM ET near-money momentum plays.
 *
 * Design rationale:
 *   The final 30 minutes of 0DTE trading often produces the sharpest directional
 *   moves of the day (gamma unwind, institutional rebalancing, closing auction pull).
 *   Standard lotto (25 pts OTM) can't capture this window because theta destroys
 *   far-OTM premium at this timeframe. Power hour uses 8-pt-OTM strikes with a
 *   tighter 13-pt target — realistic for a 30-min high-conviction directional push.
 *
 * Key differences from standard lotto:
 *   - Strike: ~8 pts OTM (vs 25 pts)     – more gamma sensitivity near-money
 *   - Target: 13 pts (vs 25 pts)          – achievable in 30 min
 *   - Stop:    4 pts (vs 8 pts)           – theta burning, cut fast
 *   - Confirm: 3 pts from anchor (vs 5)   – tighter since options move more per SPX pt
 *   - Max prem: $0.50 (vs VIX-indexed)    – cap risk given short theta window
 *   - Min score: 45 / grade B             – needs real conviction, not any lean
 *   - 1 play max, no re-entry after stop  – too little time remaining
 */

import "server-only";

import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { PlayTechnicals } from "@/lib/spx-play-technicals";
import type { SpxPlayDirection } from "@/lib/spx-signals";
import { computeSpxConfluence } from "@/lib/spx-signals";
import { polygonConfigured } from "@/lib/providers/config";
import { trackedFetch } from "@/lib/api-tracked-fetch";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { notifyPlayDiscord } from "@/lib/spx-play-notify";
import { isEtWeekday } from "@/lib/spx-play-session-guards";
import { etClock, etMinutes } from "@/lib/spx-play-session-time";
import {
  POWER_HOUR_SIZING_NOTE,
  playPowerHourConfirmMovePts,
  playPowerHourEndEtHour,
  playPowerHourEndEtMin,
  playPowerHourMaxPremium,
  playPowerHourMinScore,
  playPowerHourStartEtHour,
  playPowerHourStartEtMin,
  playPowerHourStopLossPts,
  playPowerHourStrikeOffsetPts,
  playPowerHourTargetPts,
  playPowerHourWatchExpiryMarginMin,
} from "@/lib/spx-play-config";
import {
  clearPowerHourRecord,
  loadPowerHourRecord,
  savePowerHourRecord,
  type PowerHourPhase,
  type PowerHourRecord,
} from "@/lib/spx-power-hour-store";

// ---------------------------------------------------------------------------
// Public payload type
// ---------------------------------------------------------------------------

export type PowerHourPlayPayload = {
  phase: PowerHourPhase;
  direction: SpxPlayDirection | null;
  strike: number | null;
  contract_label: string | null;
  premium_estimate: string | null;
  entry_price: number | null;
  anchor_price: number | null;
  target_pts: number;
  target_price: number | null;
  stop_pts: number;
  stop_price: number | null;
  pnl_pts: number | null;
  peak_pnl_pts: number | null;
  confidence: number;
  headline: string;
  thesis: string;
  status_message: string;
  sizing_note: string;
  window_closes_at: string;
};

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

function windowStartMins(): number {
  return etClock(playPowerHourStartEtHour(), playPowerHourStartEtMin());
}

function windowEndMins(): number {
  return etClock(playPowerHourEndEtHour(), playPowerHourEndEtMin());
}

function watchExpiryMins(): number {
  return windowEndMins() - playPowerHourWatchExpiryMarginMin();
}

function windowCloseLabel(): string {
  const h = playPowerHourEndEtHour();
  const m = playPowerHourEndEtMin();
  return `${h}:${String(m).padStart(2, "0")} ET`;
}

export function isPowerHourWindow(now = new Date()): boolean {
  if (!isEtWeekday(now)) return false;
  const m = etMinutes(now);
  return m >= windowStartMins() && m < windowEndMins();
}

export function isPastPowerHourWindow(now = new Date()): boolean {
  return isEtWeekday(now) && etMinutes(now) >= windowEndMins();
}

function isWatchExpired(now = new Date()): boolean {
  return etMinutes(now) >= watchExpiryMins();
}

// ---------------------------------------------------------------------------
// Session date
// ---------------------------------------------------------------------------

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

// ---------------------------------------------------------------------------
// Option chain builder — near-money strikes
// ---------------------------------------------------------------------------

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

type RawContract = {
  details?: { strike_price?: number; contract_type?: string; ticker?: string };
  day?: { volume?: number };
  open_interest?: number;
  last_quote?: { bid?: number; ask?: number; midpoint?: number };
  greeks?: { delta?: number };
};

async function buildPowerHourOptionTicket(
  spot: number,
  direction: SpxPlayDirection,
  _vix?: number | null
): Promise<{
  strike: number;
  contract_label: string;
  premium_estimate: string;
  spread_pct: number | null;
  blocked: boolean;
  block_reason: string | null;
}> {
  const offsetPts = playPowerHourStrikeOffsetPts();
  const maxPrem = playPowerHourMaxPremium();
  const fallbackStrike = round5(spot) + (direction === "long" ? offsetPts : -offsetPts);

  const fallback = (reason: string) => ({
    strike: fallbackStrike,
    contract_label: `SPXW ${todayEtYmd().replace(/-/g, "").slice(2)} ${direction === "long" ? "C" : "P"}${fallbackStrike}`,
    premium_estimate: `~$0.15–$0.50`,
    spread_pct: null,
    blocked: true,
    block_reason: reason,
  });

  if (!polygonConfigured()) return fallback("Polygon not configured");

  try {
    const optType = direction === "long" ? "call" : "put";
    const exp = todayEtYmd();
    const minStrike = direction === "long" ? spot + 3 : spot - 3 - offsetPts * 2;
    const maxStrike = direction === "long" ? spot + 3 + offsetPts * 2 : spot - 3;

    const url =
      `https://api.polygon.io/v3/snapshot/options/I:SPX` +
      `?contract_type=${optType}` +
      `&expiration_date=${exp}` +
      `&strike_price_gte=${Math.floor(minStrike)}` +
      `&strike_price_lte=${Math.ceil(maxStrike)}` +
      `&limit=30` +
      `&apiKey=${process.env.POLYGON_API_KEY}`;

    const res = await trackedFetch("polygon", "/v3/snapshot/options/I:SPX", url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return fallback(`Chain fetch ${res.status}`);

    const json = await res.json() as { results?: RawContract[] };
    const contracts = json.results ?? [];

    const minOtm = offsetPts - 5;

    const candidates = contracts.filter((c) => {
      const strike = c.details?.strike_price ?? 0;
      const bid = c.last_quote?.bid ?? 0;
      const ask = c.last_quote?.ask ?? 0;
      const mid = c.last_quote?.midpoint ?? (bid + ask) / 2;
      const otmPts = direction === "long" ? strike - spot : spot - strike;
      const oi = c.open_interest ?? 0;
      const vol = c.day?.volume ?? 0;
      const spread = ask > 0 ? (ask - bid) / ask : 1;
      return (
        otmPts >= minOtm &&
        mid >= 0.05 &&
        mid <= maxPrem &&
        spread <= 0.60 &&
        (oi >= 5 || vol >= 5)
      );
    });

    if (!candidates.length) return fallback("No qualifying near-money contract");

    // Pick the one closest to the target OTM offset with best liquidity
    const scored = candidates.map((c) => {
      const strike = c.details?.strike_price ?? 0;
      const bid = c.last_quote?.bid ?? 0;
      const ask = c.last_quote?.ask ?? 0;
      const mid = c.last_quote?.midpoint ?? (bid + ask) / 2;
      const otmPts = direction === "long" ? strike - spot : spot - strike;
      const otmScore = 1 - Math.abs(otmPts - offsetPts) / offsetPts;
      const spread = ask > 0 ? (ask - bid) / ask : 1;
      const spreadScore = 1 - spread;
      const premScore = 1 - Math.abs(mid - maxPrem * 0.6) / (maxPrem * 0.6);
      return { c, strike, bid, ask, mid, spread, score: otmScore * 2 + spreadScore + premScore };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const strike = best.strike;
    const mid = best.mid;
    const spreadPct = best.ask > 0 ? (best.ask - best.bid) / best.ask : null;
    const yy = exp.slice(2, 4) + exp.slice(5, 7) + exp.slice(8, 10);
    const label = `SPXW ${yy} ${direction === "long" ? "C" : "P"}${strike}`;
    const lo = Math.max(0.05, mid - 0.08).toFixed(2);
    const hi = (mid + 0.08).toFixed(2);

    return {
      strike,
      contract_label: label,
      premium_estimate: `~$${lo}–$${hi}`,
      spread_pct: spreadPct != null ? Math.round(spreadPct * 100) : null,
      blocked: false,
      block_reason: null,
    };
  } catch {
    return fallback("Chain error");
  }
}

// ---------------------------------------------------------------------------
// PnL helpers
// ---------------------------------------------------------------------------

function pnlPts(direction: SpxPlayDirection, entry: number, current: number): number {
  return direction === "long" ? current - entry : entry - current;
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

function nonePayload(
  reason: "off_hours" | "no_setup" | "expired" | "stopped" | "closed_for_today" | "invalidated"
): PowerHourPlayPayload {
  const msgs: Record<typeof reason, string> = {
    off_hours: "Outside power hour window (2:45–3:15 PM ET)",
    no_setup: "Scanning power hour — waiting for B+ confluence signal",
    expired: "Power hour WATCH expired unconfirmed — window closed",
    stopped: "Power hour stopped — no re-entry",
    closed_for_today: "Power hour play closed for today",
    invalidated: "Power hour setup invalidated — adverse move",
  };
  return {
    phase: "NONE",
    direction: null,
    strike: null,
    contract_label: null,
    premium_estimate: null,
    entry_price: null,
    anchor_price: null,
    target_pts: playPowerHourTargetPts(),
    target_price: null,
    stop_pts: playPowerHourStopLossPts(),
    stop_price: null,
    pnl_pts: null,
    peak_pnl_pts: null,
    confidence: 0,
    headline: "Power Hour — No Active Play",
    thesis: msgs[reason],
    status_message: msgs[reason],
    sizing_note: POWER_HOUR_SIZING_NOTE,
    window_closes_at: windowCloseLabel(),
  };
}

function recordToPayload(rec: PowerHourRecord, currentPrice?: number): PowerHourPlayPayload {
  const pnl =
    rec.entry_price != null && currentPrice != null
      ? pnlPts(rec.direction, rec.entry_price, currentPrice)
      : null;

  const phaseMsg: Record<PowerHourPhase, string> = {
    NONE: "No active power hour play",
    WATCH: `Watching ${rec.direction === "long" ? "long" : "short"} — need ${playPowerHourConfirmMovePts()} pt move from ${rec.anchor_price?.toFixed(2) ?? "—"}`,
    HOLD: `In power hour ${rec.direction === "long" ? "long" : "short"} from ${rec.entry_price?.toFixed(2) ?? "—"} · target ${rec.target_price?.toFixed(0) ?? "—"} · stop ${rec.stop_price?.toFixed(0) ?? "—"}`,
    SELL: "Power hour play closed",
  };

  return {
    phase: rec.phase,
    direction: rec.direction,
    strike: rec.strike,
    contract_label: rec.contract_label,
    premium_estimate: rec.premium_estimate,
    entry_price: rec.entry_price,
    anchor_price: rec.anchor_price,
    target_pts: rec.target_pts,
    target_price: rec.target_price,
    stop_pts: rec.stop_pts,
    stop_price: rec.stop_price,
    pnl_pts: pnl,
    peak_pnl_pts: rec.peak_pnl_pts || null,
    confidence: rec.confidence,
    headline: rec.headline,
    thesis: rec.thesis,
    status_message: phaseMsg[rec.phase],
    sizing_note: POWER_HOUR_SIZING_NOTE,
    window_closes_at: windowCloseLabel(),
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function evaluateSpxPowerHour(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals | null
): Promise<PowerHourPlayPayload> {
  const now = new Date();
  const price = desk.price;
  if (!price || price <= 0) return nonePayload("off_hours");

  const rec = await loadPowerHourRecord();

  // Already closed for today
  if (rec?.phase === "SELL") return nonePayload("closed_for_today");

  // Outside window entirely (before or after)
  if (!isPowerHourWindow(now)) {
    // After the window: if we had an open HOLD, force-exit it
    if (isPastPowerHourWindow(now) && rec?.phase === "HOLD") {
      const finalPnl = rec.entry_price != null ? pnlPts(rec.direction, rec.entry_price, price) : 0;
      await savePowerHourRecord({ ...rec, phase: "SELL", peak_pnl_pts: Math.max(rec.peak_pnl_pts, finalPnl) });
      void notifyPlayDiscord({
        action: "SELL",
        direction: rec.direction,
        headline: `Power hour THETA flat — ${windowCloseLabel()} cutoff`,
        thesis: `Power hour closed at ${windowCloseLabel()} · PnL: ${finalPnl >= 0 ? "+" : ""}${finalPnl.toFixed(1)} pts`,
        price,
        grade: "B",
        score: rec.confidence,
      });
      return nonePayload("closed_for_today");
    }
    return nonePayload("off_hours");
  }

  // ---- HOLD branch ----
  if (rec?.phase === "HOLD" && rec.entry_price != null) {
    const currentPnl = pnlPts(rec.direction, rec.entry_price, price);
    const peakPnl = Math.max(rec.peak_pnl_pts, currentPnl);

    // Target hit
    if (rec.target_price != null) {
      const targetHit =
        rec.direction === "long" ? price >= rec.target_price : price <= rec.target_price;
      if (targetHit) {
        await savePowerHourRecord({ ...rec, phase: "SELL", peak_pnl_pts: peakPnl });
        void notifyPlayDiscord({
          action: "SELL",
          direction: rec.direction,
          headline: `Power hour TARGET — +${rec.target_pts} pts`,
          thesis: `Hit ${rec.target_price.toFixed(0)} from ${rec.entry_price.toFixed(2)} · power hour win`,
          price,
          grade: "B",
          score: rec.confidence,
        });
        return nonePayload("closed_for_today");
      }
    }

    // Stop hit
    if (rec.stop_price != null) {
      const stopHit =
        rec.direction === "long" ? price <= rec.stop_price : price >= rec.stop_price;
      if (stopHit) {
        await savePowerHourRecord({ ...rec, phase: "SELL", peak_pnl_pts: peakPnl });
        void notifyPlayDiscord({
          action: "SELL",
          direction: rec.direction,
          headline: `Power hour STOP — −${rec.stop_pts} pts`,
          thesis: `Stopped at ${rec.stop_price.toFixed(0)} from ${rec.entry_price.toFixed(2)}`,
          price,
          grade: "B",
          score: rec.confidence,
        });
        return nonePayload("stopped");
      }
    }

    // Still in play
    const updated = { ...rec, peak_pnl_pts: peakPnl };
    await savePowerHourRecord(updated);
    return recordToPayload(updated, price);
  }

  // ---- WATCH branch ----
  if (rec?.phase === "WATCH") {
    // WATCH expired — too close to window end
    if (isWatchExpired(now)) {
      await clearPowerHourRecord();
      return nonePayload("expired");
    }

    const confirmPts = playPowerHourConfirmMovePts();
    const stopPts = playPowerHourStopLossPts();
    const move = pnlPts(rec.direction, rec.anchor_price, price);

    // Confirm: price moved confirmPts in direction
    const confirmed = move >= confirmPts;

    // Invalidate: price moved stopPts against direction (no entry)
    const invalidated = move <= -stopPts;

    // Optional: technicals soft-confirm (5m trend aligned)
    const techAligned =
      !technicals?.available ||
      (rec.direction === "long"
        ? technicals.m5_trend === "up" || technicals.m5_trend === "flat"
        : technicals.m5_trend === "down" || technicals.m5_trend === "flat");

    if (confirmed && techAligned) {
      const targetPts = rec.target_pts;
      const targetPrice =
        rec.direction === "long" ? price + targetPts : price - targetPts;
      const stopPrice =
        rec.direction === "long" ? price - stopPts : price + stopPts;

      const entered: PowerHourRecord = {
        ...rec,
        phase: "HOLD",
        entry_price: price,
        target_price: targetPrice,
        stop_price: stopPrice,
        stop_pts: stopPts,
        peak_pnl_pts: 0,
        entered_at: now.toISOString(),
      };
      await savePowerHourRecord(entered);
      void notifyPlayDiscord({
        action: "BUY",
        direction: rec.direction,
        headline: `Power Hour BUY ${rec.contract_label ?? ""} · target +${targetPts} pts`,
        thesis: rec.thesis,
        price,
        grade: "B",
        score: rec.confidence,
      });
      return recordToPayload(entered, price);
    }

    if (invalidated) {
      await clearPowerHourRecord();
      return nonePayload("invalidated");
    }

    return recordToPayload(rec, price);
  }

  // ---- NONE — scan for a new play ----

  // Watch expired before we found a setup
  if (isWatchExpired(now)) return nonePayload("expired");

  const confluence = computeSpxConfluence(desk);
  if (!confluence || !confluence.direction) return nonePayload("no_setup");

  const abs = Math.abs(confluence.score);
  const direction = confluence.direction;

  // Need B+ grade and meaningful score
  if (abs < playPowerHourMinScore()) return nonePayload("no_setup");

  // Need at least 4 agreeing factors
  const agreeing =
    direction === "long"
      ? confluence.factors.filter((f) => f.weight > 0).length
      : confluence.factors.filter((f) => f.weight < 0).length;
  if (agreeing < 4) return nonePayload("no_setup");

  // Build option ticket
  const ticket = await buildPowerHourOptionTicket(price, direction, desk.vix);

  const targetPts = playPowerHourTargetPts();
  const session_date = todayEt();
  const watch: PowerHourRecord = {
    session_date,
    phase: "WATCH",
    direction,
    anchor_price: price,
    entry_price: null,
    strike: ticket.strike,
    contract_label: ticket.contract_label,
    premium_estimate: ticket.premium_estimate,
    spread_pct: ticket.spread_pct,
    target_pts: targetPts,
    target_price: null,
    stop_pts: playPowerHourStopLossPts(),
    stop_price: null,
    peak_pnl_pts: 0,
    confidence: confluence.confidence,
    headline: `Power Hour ${direction === "long" ? "Bullish" : "Bearish"} — ${confluence.grade} grade · score ${abs}`,
    thesis: `${confluence.grade} ${direction === "long" ? "bullish" : "bearish"} confluence into power hour · targeting +${targetPts} pts · ${ticket.contract_label}`,
    started_at: now.toISOString(),
    entered_at: null,
  };

  await savePowerHourRecord(watch);
  void notifyPlayDiscord({
    action: "BUY",
    direction,
    headline: `Power Hour WATCH — ${watch.headline}`,
    thesis: watch.thesis,
    price,
    grade: confluence.grade,
    score: abs,
  });

  return recordToPayload(watch, price);
}

/**
 * Read-only power-hour projection — NO saves, clears, scans, or Discord. Mirrors
 * evaluateSpxPowerHour's RENDER branches only; advancing state (entry/exit/force-exit)
 * is the spx-evaluate cron's job (single writer). Read paths (admin dry-run, cron
 * skip-branch) call this so they can't mutate state or fire subscriber alerts (audit P1).
 */
export async function readSpxPowerHourSnapshot(desk: SpxDeskPayload): Promise<PowerHourPlayPayload> {
  const now = new Date();
  const price = desk.price;
  if (!price || price <= 0) return nonePayload("off_hours");

  const rec = await loadPowerHourRecord();
  if (rec?.phase === "SELL") return nonePayload("closed_for_today");

  if (!isPowerHourWindow(now)) {
    // Past-window open HOLD: render it truthfully — the cron force-exits at the cutoff.
    if (isPastPowerHourWindow(now) && rec?.phase === "HOLD") return recordToPayload(rec, price);
    return nonePayload("off_hours");
  }

  if (rec?.phase === "HOLD") return recordToPayload(rec, price);
  if (rec?.phase === "WATCH") {
    if (isWatchExpired(now)) return nonePayload("expired");
    return recordToPayload(rec, price);
  }
  // No record / NONE — read-only can't scan for a new setup; show no_setup (or expired).
  if (isWatchExpired(now)) return nonePayload("expired");
  return nonePayload("no_setup");
}
