/**
 * Pure helpers that turn a single clicked HELIX flow print (`FlowAlert`) into the
 * fields the drilldown window shows ABOUT THAT PRINT.
 *
 * WHY this module exists: the drilldown previously re-fetched only aggregate contract
 * data (OI / day-volume / intraday) keyed by ticker+strike+expiry and threw away the
 * rich, real per-print payload the user actually clicked (premium, fill, spot-at-fill,
 * OI, IV, OTM%, DTE, rule tags, gamma-wall proximity). Everything here derives strictly
 * from fields already present on the print — no fabrication. Two fields are *derived*
 * (est. contract size, est. notional) and are labelled "est." in the UI because they are
 * reconstructed from premium ÷ fill, not served directly.
 */

import type { FlowAlert } from "@/lib/api";

/**
 * Estimated contract count for a single print.
 *
 * UW `total_premium` = contracts × per-share fill × 100 (100 shares / contract). So when
 * both the dollar premium and the per-share fill are present we can back out the size:
 *   contracts = premium / (fill × 100)
 * This is an ESTIMATE (labelled as such in the UI): multi-leg prints, averaged fills, and
 * rounding make it approximate. Returns null when either input is missing/non-positive so
 * the UI omits the chip rather than showing a bogus 0 or Infinity.
 */
export function estContractSize(premium: number | null | undefined, fillPrice: number | null | undefined): number | null {
  if (premium == null || fillPrice == null) return null;
  if (!Number.isFinite(premium) || !Number.isFinite(fillPrice)) return null;
  if (premium <= 0 || fillPrice <= 0) return null;
  const contracts = premium / (fillPrice * 100);
  if (!Number.isFinite(contracts) || contracts <= 0) return null;
  return Math.round(contracts);
}

/**
 * Estimated underlying notional the print controls (dollar value of the shares the
 * contracts represent), NOT the premium paid:
 *   notional = contracts × 100 × strike = premium × strike / fill
 * Derived from the same premium ÷ fill reconstruction as {@link estContractSize}, so it is
 * likewise an estimate. Returns null when it can't be computed from real inputs.
 */
export function estNotional(
  strike: number | null | undefined,
  premium: number | null | undefined,
  fillPrice: number | null | undefined
): number | null {
  const size = estContractSize(premium, fillPrice);
  if (size == null) return null;
  if (strike == null || !Number.isFinite(strike) || strike <= 0) return null;
  return size * 100 * strike;
}

export type AggressorRead = { label: string; tone: "bull" | "bear" | "neutral" };

/**
 * Aggressor read from UW `ask_side_pct` (share of the print's volume that traded on the
 * ask). High ask-side = buyer lifting the offer (aggressive/bullish for the option leg);
 * low ask-side = seller hitting the bid. Thresholds mirror the desk's usual 60/40 split.
 * Returns null when ask_pct is absent so we never invent a lean.
 */
export function aggressorRead(askPct: number | null | undefined): AggressorRead | null {
  if (askPct == null || !Number.isFinite(askPct)) return null;
  if (askPct >= 60) return { label: `At ask · ${Math.round(askPct)}% bought`, tone: "bull" };
  if (askPct <= 40) return { label: `At bid · ${Math.round(100 - askPct)}% sold`, tone: "bear" };
  return { label: `Midpoint · ${Math.round(askPct)}% ask`, tone: "neutral" };
}

/** Human label for the server-computed GEX wall proximity (never fabricated upstream). */
export function gexProximityLabel(proximity: string | null | undefined): string | null {
  switch (proximity) {
    case "at_gamma_flip":
      return "At gamma flip";
    case "at_call_wall":
      return "At call wall";
    case "at_put_wall":
      return "At put wall";
    case "near_call_wall":
      return "Near call wall";
    case "near_put_wall":
      return "Near put wall";
    default:
      return null;
  }
}

/**
 * Net directional lean of the print for the underlying: a call bought (ask-side) or a put
 * sold is bullish; a put bought or a call sold is bearish. Uses only option_type + the
 * aggressor read; returns "neutral" when the aggressor is unknown/midpoint.
 */
export function printBias(flow: Pick<FlowAlert, "option_type" | "ask_pct">): "bullish" | "bearish" | "neutral" {
  const isCall = flow.option_type?.toUpperCase() === "CALL";
  const aggr = aggressorRead(flow.ask_pct);
  if (!aggr || aggr.tone === "neutral") return "neutral";
  const bought = aggr.tone === "bull";
  if (isCall) return bought ? "bullish" : "bearish";
  return bought ? "bearish" : "bullish";
}
