// ---------------------------------------------------------------------------
// 0DTE / FRONT-EXPIRY INTRADAY-ADJUSTED GEX — PURE core (no server-only, no I/O).
//
// This file holds ONLY the framework-free math + types for the intraday-adjusted GEX lens, so it is
// directly unit-testable under `tsx --test` (no `server-only` throw, no network). The server-bound
// orchestration (cache, upstream fetches) lives in `gex-intraday-adjust.ts`, which imports from
// here. All imports below are TYPE-ONLY (erased at runtime) so this module pulls in nothing server.
//
// MODEL (decided + documented — see gex-intraday-adjust.ts header for the full rationale):
//   Keep the canonical OI-weighted GEX UNCHANGED + PRIMARY. For the FRONT (0DTE / nearest) expiry
//   ONLY, estimate today's not-yet-settled net dealer positioning from SIGNED customer flow (quote
//   rule: at/above ask → customer buy → +, at/below bid → customer sell → −) and ADD it to the OI
//   base to produce a SEPARATE, clearly-LABELED view. Per front-expiry strike K:
//     netCustomerGammaContracts(K) = netCallContractsSigned(K) + netPutContractsSigned(K)
//     dealerGammaAdjust(K)         = − gammaCoeff(K) · netCustomerGammaContracts(K)
//       gammaCoeff(K) = γ · shares_per_contract · spot² · 0.01  (ONE long contract's dollar gamma
//       on the SAME per-1%-move scale as gex.strike_totals — so the nudge is dimensionally exact)
//     adjustedStrikeTotal(K) = oiFrontStrikeTotal(K) + dealerGammaAdjust(K)
//   Non-front strikes carry their OI total UNCHANGED. Flip/walls/net are recomputed on the adjusted
//   totals and labeled distinctly. The canonical OI fields are NEVER overwritten.
// ---------------------------------------------------------------------------

import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";
import type { OptionTradesAggregate } from "@/lib/providers/option-trades";

/**
 * The intraday-adjusted GEX view for ONE ticker's FRONT (0DTE / nearest) expiry. Every field is an
 * ESTIMATE built on top of the canonical OI base — labeled accordingly. Canonical OI GEX is
 * surfaced UNCHANGED on the heatmap / GexPositioning; this object never overwrites it.
 */
export type GexIntradayAdjusted = {
  ticker: string;
  /** The front expiry the adjustment is scoped to (YYYY-MM-DD). */
  front_expiry: string;
  spot: number;
  /** ISO timestamp this view was computed. */
  asof: string;

  /** Adjusted net dealer dollar-gamma (signed): canonical near-term net GEX + front-expiry nudge. */
  net_gex_adjusted: number;
  /** Canonical OI-based net GEX (UNCHANGED) — carried for side-by-side display. */
  net_gex_oi: number;
  /** Signed adjustment applied to net GEX from front-expiry intraday flow (adjusted − OI). */
  net_gex_adjustment: number;

  /** Per-strike adjusted net dealer dollar-gamma (OI base + front-expiry nudge). Sparse. */
  strike_totals_adjusted: Record<string, number>;

  /** Recomputed levels on the ADJUSTED totals (clearly distinct from the canonical OI levels). */
  flip_adjusted: number | null;
  call_wall_adjusted: number | null;
  put_wall_adjusted: number | null;

  /** Honest diagnostics on how strong the intraday signal was. */
  meta: {
    /** Window (minutes) of trades used. */
    window_min: number;
    /** Counted front-expiry prints. */
    total_prints: number;
    /** Prints that could be side-classified via the quote rule (had a usable NBBO). */
    side_classified_prints: number;
    /** side_classified_prints / total_prints, 0..1. Low ⇒ weak signal ⇒ view ≈ OI base. */
    classification_coverage: number;
    /** True when the trades pull was partial (≥1 contract upstream failure). */
    partial: boolean;
  };

  /** Human label + tooltip — every UI surface must show these so users know this is the volume model. */
  label: string;
  tooltip: string;
  /** Provenance. */
  source: "polygon";
  /** Model id: 'signed-flow' when coverage is usable, 'thin' when the estimate is weak. */
  model: "signed-flow" | "thin";
};

/**
 * Quote-rule trade side classification (Lee-Ready style, quote-only): compare a print's PRICE to
 * the contract's contemporaneous NBBO.
 *   price ≥ ask           → customer BUY  → +1
 *   price ≤ bid           → customer SELL → −1
 *   bid < price < ask     → at-mid / inside → 0 (unclassifiable; do NOT guess a side)
 * Returns 0 when the NBBO is missing / inverted / zero-width. The NBBO here is the single
 * last-quote snapshot taken at discovery time (one quote per contract, NO per-trade /v3/quotes
 * fan-out), not the NBBO at each trade's exact nanosecond — so this is a BOUNDED, near-real-time
 * approximation of true tick-level signing (labeled an ESTIMATE downstream), but far better than
 * gross premium which ignores side entirely, at zero extra fan-out cost.
 */
export function classifyTradeSide(
  price: number,
  bid: number | null,
  ask: number | null
): -1 | 0 | 1 {
  if (bid == null || ask == null || !(bid > 0) || !(ask > 0) || ask <= bid) return 0;
  if (price >= ask) return 1;
  if (price <= bid) return -1;
  return 0; // strictly inside the spread → at-mid, don't guess
}

export const GEX_INTRADAY_LABEL = "Intraday-adjusted (OI + volume model) — 0DTE";
export const GEX_INTRADAY_TOOLTIP =
  "Estimate. Canonical GEX is open-interest based (the standard); this view ADDS today's " +
  "front-expiry (0DTE) intraday net dealer positioning, signed buy-vs-sell from the trade tape " +
  "via the quote rule, to capture same-day gamma that settled OI misses. Front expiry only.";

/** Linear-interpolated zero-gamma flip from per-strike totals (mirrors the matrix flip helper). */
export function zeroGammaFlip(strikeTotals: Record<string, number>, spot: number): number | null {
  const rows = Object.entries(strikeTotals)
    .map(([s, g]) => ({ strike: Number(s), gamma: g }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.gamma))
    .sort((a, b) => a.strike - b.strike);
  if (rows.length < 2) return null;
  const crossings: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (a.gamma < 0 && b.gamma > 0) {
      const frac = (0 - a.gamma) / (b.gamma - a.gamma);
      crossings.push(Number((a.strike + (b.strike - a.strike) * frac).toFixed(2)));
    }
  }
  if (!crossings.length) return null;
  return spot > 0
    ? crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best))
    : crossings[crossings.length - 1];
}

/** Largest-positive (call) and largest-negative (put) net-gamma strikes from per-strike totals. */
export function walls(
  strikeTotals: Record<string, number>
): { call: number | null; put: number | null } {
  let call: number | null = null;
  let put: number | null = null;
  let maxPos = 0;
  let maxNeg = 0;
  for (const [s, g] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    if (g > maxPos) {
      maxPos = g;
      call = strike;
    }
    if (g < maxNeg) {
      maxNeg = g;
      put = strike;
    }
  }
  return { call, put };
}

/**
 * PURE builder — derive the adjusted view from an ALREADY-FETCHED OI matrix + trades tape + gamma
 * coefficients. No upstream call, no cache. Returns null when the OI base is cold/empty (never
 * fabricates an adjustment on nothing).
 */
export function gexIntradayAdjustedFrom(
  ticker: string,
  hm: GexHeatmap | null,
  trades: OptionTradesAggregate | null,
  coeffs: Record<string, number> | null,
  frontExpiry: string | null,
  spot: number,
  win: number
): GexIntradayAdjusted | null {
  const root = String(ticker ?? "").trim().toUpperCase();
  if (!root) return null;
  // OI base must exist — the adjustment is a NUDGE on the canonical totals, never a standalone view.
  if (!hm || !(hm.spot > 0) || hm.strikes.length === 0) return null;
  if (!frontExpiry) return null;

  const oiStrikeTotals = hm.gex.strike_totals;
  const netGexOi = hm.gex.total;

  // Start from a copy of the canonical OI per-strike totals — the adjusted view differs ONLY in
  // the front-expiry contribution; every other strike/expiry stays byte-identical to the OI base.
  const adjusted: Record<string, number> = { ...oiStrikeTotals };

  let netAdjustment = 0;
  let totalPrints = 0;
  let sideClassifiedPrints = 0;
  let partial = false;

  if (trades) {
    totalPrints = trades.totalPrints;
    sideClassifiedPrints = trades.meta.sideClassifiedPrints;
    partial = trades.meta.partial;
    const coeffMap = coeffs ?? {};
    for (const sp of trades.byStrike) {
      const key = String(sp.strike);
      const coeff = coeffMap[key];
      if (!Number.isFinite(coeff) || !(coeff > 0)) continue; // no gamma coeff at this strike → skip
      // Net SIGNED customer contracts (calls + puts) — both legs are long gamma for the buyer; the
      // quote-rule sign already encodes who is net long. Dealer is the negation (counterparty).
      const netCustomerContracts = sp.netCallContractsSigned + sp.netPutContractsSigned;
      if (!Number.isFinite(netCustomerContracts) || netCustomerContracts === 0) continue;
      const dealerGammaAdjust = -(coeff * netCustomerContracts);
      if (!Number.isFinite(dealerGammaAdjust) || dealerGammaAdjust === 0) continue;
      adjusted[key] = (adjusted[key] ?? 0) + dealerGammaAdjust;
      netAdjustment += dealerGammaAdjust;
    }
  }

  const netGexAdjusted = netGexOi + netAdjustment;
  const flipAdjusted = zeroGammaFlip(adjusted, spot);
  const w = walls(adjusted);
  const coverage = totalPrints > 0 ? Number((sideClassifiedPrints / totalPrints).toFixed(3)) : 0;
  // 'thin' when the estimate is weak (no classified prints / no net adjustment) → view ≈ OI base.
  const model: "signed-flow" | "thin" =
    sideClassifiedPrints > 0 && netAdjustment !== 0 ? "signed-flow" : "thin";

  return {
    ticker: root,
    front_expiry: frontExpiry,
    spot,
    asof: new Date().toISOString(),
    net_gex_adjusted: netGexAdjusted,
    net_gex_oi: netGexOi,
    net_gex_adjustment: netAdjustment,
    strike_totals_adjusted: adjusted,
    flip_adjusted: flipAdjusted,
    call_wall_adjusted: w.call,
    put_wall_adjusted: w.put,
    meta: {
      window_min: win,
      total_prints: totalPrints,
      side_classified_prints: sideClassifiedPrints,
      classification_coverage: coverage,
      partial,
    },
    label: GEX_INTRADAY_LABEL,
    tooltip: GEX_INTRADAY_TOOLTIP,
    source: "polygon",
    model,
  };
}
