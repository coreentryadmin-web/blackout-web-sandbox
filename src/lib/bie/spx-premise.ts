// Premise correction — compare member question framing vs live desk truth.

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

function fmt(n: number, d = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/**
 * Detect when the question assumes wrong positioning vs live desk.
 * Returns CORRECTION lines prepended to synthesis (deterministic, no LLM).
 */
export function detectPremiseCorrections(question: string, desk: SpxDeskPayload): string[] {
  const q = question.trim().toLowerCase();
  if (!q) return [];
  const out: string[] = [];
  const price = desk.price;
  const vwap = desk.vwap;

  if (price != null && vwap != null && Number.isFinite(price) && Number.isFinite(vwap)) {
    const diff = price - vwap;
    const above = diff >= 0;
    const asksBelow =
      /\b(below|under|beneath)\b/.test(q) && /\bvwap\b/.test(q);
    const asksAbove =
      /\b(above|over)\b/.test(q) && /\bvwap\b/.test(q);
    if (asksBelow && above && Math.abs(diff) >= 0.5) {
      out.push(
        `CORRECTION  Spot is +${fmt(diff, 0)} pts ABOVE VWAP ${fmt(vwap, 2)} — not below; desk read reflects live tape.`
      );
    } else if (asksAbove && !above && Math.abs(diff) >= 0.5) {
      out.push(
        `CORRECTION  Spot is ${fmt(diff, 0)} pts BELOW VWAP ${fmt(vwap, 2)} — not above; desk read reflects live tape.`
      );
    }
  }

  const flip = desk.gamma_flip;
  if (price != null && flip != null && desk.above_gamma_flip != null) {
    const asksBelowFlip =
      /\b(below|under)\b/.test(q) &&
      /\b(gamma flip|γ\s*flip|gex flip|gamma-flip)\b/.test(q);
    const asksAboveFlip =
      /\b(above|over)\b/.test(q) &&
      /\b(gamma flip|γ\s*flip|gex flip|gamma-flip)\b/.test(q);
    if (asksBelowFlip && desk.above_gamma_flip) {
      out.push(
        `CORRECTION  Spot is ABOVE γflip ${fmt(flip, 0)} — dealers long γ (pin/mean-revert bias), not below flip.`
      );
    } else if (asksAboveFlip && !desk.above_gamma_flip) {
      out.push(
        `CORRECTION  Spot is BELOW γflip ${fmt(flip, 0)} — dealers short γ (trend-fuel bias), not above flip.`
      );
    }
  }

  if (/\b(bearish|dump|sell.?off|tank|crash)\b/.test(q) && desk.spx_change_pct != null && desk.spx_change_pct > 0.05) {
    out.push(
      `CORRECTION  SPX is +${fmt(desk.spx_change_pct, 2)}% on session — tape is green, not dumping.`
    );
  }
  if (/\b(bullish|rally|rip|moon)\b/.test(q) && desk.spx_change_pct != null && desk.spx_change_pct < -0.05) {
    out.push(
      `CORRECTION  SPX is ${fmt(desk.spx_change_pct, 2)}% on session — tape is red, not ripping.`
    );
  }

  return out.slice(0, 2);
}
