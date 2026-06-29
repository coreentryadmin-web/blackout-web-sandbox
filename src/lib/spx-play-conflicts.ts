import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { SpxSignalFactor } from "@/lib/spx-signals";

/** Canonical news-sentiment patterns — imported by spx-play-confirmations.ts as well. */
export const BEAR_NEWS =
  /\b(crash|plunge|selloff|sell-off|hawkish|hot cpi|inflation surge|war|recession|downgrade|lawsuit|probe|tariff)\b/i;
export const BULL_NEWS =
  /\b(rally|surge|soar|dovish|rate cut|beat estimates|record high|stimulus|ceasefire)\b/i;

function newsSentiment(headlines: SpxDeskPayload["news_headlines"]): "bullish" | "bearish" | "neutral" {
  let bull = 0;
  let bear = 0;
  for (const h of headlines.slice(0, 5)) {
    const t = h.title ?? "";
    if (BEAR_NEWS.test(t)) bear += 1;
    if (BULL_NEWS.test(t)) bull += 1;
  }
  if (bear > bull) return "bearish";
  if (bull > bear) return "bullish";
  return "neutral";
}

function factorOpposes(direction: "long" | "short", factor: SpxSignalFactor): boolean {
  return (direction === "long" && factor.weight < 0) || (direction === "short" && factor.weight > 0);
}

function isHardOpposingFactor(factor: SpxSignalFactor): boolean {
  const label = factor.label;
  return (
    label === "Market tide" ||
    label === "Dark pool" ||
    label === "IV rank" ||
    label.includes("γ") ||
    label.includes("GEX resistance") ||
    label.includes("GEX support")
  );
}

function gexOpposed(desk: SpxDeskPayload, direction: "long" | "short"): boolean {
  if (direction === "long") {
    return (
      (desk.gamma_regime === "amplification" && !desk.above_gamma_flip) ||
      Boolean(desk.gex_walls?.some((w) => w.kind === "resistance" && Math.abs(desk.price - w.strike) <= 12))
    );
  }
  return (
    (desk.gamma_regime === "amplification" && desk.above_gamma_flip) ||
    Boolean(desk.gex_walls?.some((w) => w.kind === "support" && Math.abs(desk.price - w.strike) <= 12))
  );
}

function tideOpposed(desk: SpxDeskPayload, direction: "long" | "short"): boolean {
  const tide = desk.tide_bias;
  if (!tide || tide === "neutral") return false;
  return tide !== (direction === "long" ? "bullish" : "bearish");
}

function newsOpposed(desk: SpxDeskPayload, direction: "long" | "short"): boolean {
  const news = newsSentiment(desk.news_headlines ?? []);
  return (direction === "long" && news === "bearish") || (direction === "short" && news === "bullish");
}

function vixExtremeAgainst(desk: SpxDeskPayload, direction: "long" | "short"): boolean {
  if (desk.vix == null) return false;
  if (direction === "long" && desk.vix > 28) return true;
  if (direction === "short" && desk.vix < 14) return true;
  return false;
}

function newsAlreadyScored(factors: SpxSignalFactor[]): boolean {
  return factors.some((f) => f.label === "News risk" || f.label.startsWith("News"));
}

function vixAlreadyScored(factors: SpxSignalFactor[]): boolean {
  return factors.some((f) => f.label.includes("VIX") || f.label === "IV rank");
}

export function computeWeightedConflicts(
  desk: SpxDeskPayload,
  score: number,
  factors: SpxSignalFactor[]
): { conflicts: number; weighted_conflicts: number } {
  const bullFactors = factors.filter((f) => f.weight > 0).length;
  const bearFactors = factors.filter((f) => f.weight < 0).length;
  const conflicts =
    score > 0 ? bearFactors : score < 0 ? bullFactors : Math.min(bullFactors, bearFactors);
  const direction: "long" | "short" | null = score > 0 ? "long" : score < 0 ? "short" : null;
  if (!direction) return { conflicts, weighted_conflicts: conflicts };

  let weighted = 0;
  for (const f of factors) {
    if (!factorOpposes(direction, f)) continue;
    weighted += isHardOpposingFactor(f) ? 2 : 1;
  }

  if (newsOpposed(desk, direction) && !newsAlreadyScored(factors)) {
    weighted += 2;
  }
  if (tideOpposed(desk, direction) && !factors.some((f) => f.label === "Market tide")) {
    weighted += 2;
  }
  if (gexOpposed(desk, direction) && !factors.some((f) => f.label.includes("GEX") || f.label.includes("γ"))) {
    weighted += 2;
  }
  if (vixExtremeAgainst(desk, direction) && !vixAlreadyScored(factors)) {
    weighted += 2;
  }

  // weighted_conflicts is the desk-adjusted opposition score only — do NOT max() with the
  // raw opposing-factor count. That double-penalized A-grade setups (conflicts ≤ 2 for grade A)
  // whenever soft counter-trend factors stacked, blocking entry with "Tape's mixed" at threshold 4.
  return { conflicts, weighted_conflicts: weighted };
}
