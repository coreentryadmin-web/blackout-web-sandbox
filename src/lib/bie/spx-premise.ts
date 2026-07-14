// Premise correction — compare member question framing vs live desk truth.

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

function fmt(n: number, d = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ── Spatial-claim (spot vs a named level) correction ───────────────────────────────────
// The live gauntlet (PR-L4a) asked "Why is SPX pinned ABOVE its call wall right now?" when spot was
// 7,515 and the call wall was 7,550 — i.e. spot was BELOW the wall. The desk read gave a bullish take
// and never corrected the false premise. These guards catch the clearest such claims (above/below a
// call wall / put wall / gamma flip / max pain) and correct them deterministically before the read.

/** Direction the question ASSERTS for spot relative to `levelRe`, tying the direction word to the
 *  level phrase so a compound sentence ("above VWAP but below the call wall") scopes each correctly.
 *  Returns null when neither, both, or no direction is asserted next to that level (ambiguous → no
 *  correction, never a guess). */
function claimedDirection(q: string, levelRe: string): "above" | "below" | null {
  // A short bounded window (≤16 non-terminator chars) lets "above ITS call wall" / "broke ABOVE the
  // max pain" match while keeping the direction word attached to THIS level, not one across the clause.
  const above = new RegExp(`\\b(?:above|over|reclaim\\w*|cleared|topside of)\\b[^.?!]{0,16}?\\b${levelRe}\\b`).test(q);
  const below = new RegExp(`\\b(?:below|under|beneath|lost|breakdown)\\b[^.?!]{0,16}?\\b${levelRe}\\b`).test(q);
  if (above && !below) return "above";
  if (below && !above) return "below";
  return null;
}

/** The call wall — canonically the strike with the LARGEST POSITIVE net_gex (matches topGexWalls /
 *  the Heatmap so "call wall" means the same strike everywhere). Derived from the desk's own ladder. */
function callWallStrike(desk: SpxDeskPayload): number | null {
  let best: { strike: number; net_gex: number } | null = null;
  for (const w of desk.gex_walls ?? []) {
    if (!Number.isFinite(w.net_gex) || !Number.isFinite(w.strike)) continue;
    if (w.net_gex > 0 && (best === null || w.net_gex > best.net_gex)) best = w;
  }
  return best?.strike ?? null;
}

/** The put wall — canonically the strike with the LARGEST NEGATIVE (most-negative) net_gex. */
function putWallStrike(desk: SpxDeskPayload): number | null {
  let best: { strike: number; net_gex: number } | null = null;
  for (const w of desk.gex_walls ?? []) {
    if (!Number.isFinite(w.net_gex) || !Number.isFinite(w.strike)) continue;
    if (w.net_gex < 0 && (best === null || w.net_gex < best.net_gex)) best = w;
  }
  return best?.strike ?? null;
}

/** One correction line if the question asserts a spatial relation to `level` that the live spot
 *  contradicts. TOL guards the "pinned AT the wall" case (spot ≈ level is not a false above/below). */
function levelClaimCorrection(
  q: string,
  spot: number | null,
  level: number | null,
  levelRe: string,
  label: string
): string | null {
  if (spot == null || level == null || !Number.isFinite(spot) || !Number.isFinite(level)) return null;
  const dir = claimedDirection(q, levelRe);
  if (dir == null) return null;
  const TOL = 1; // pts — within a point of the wall, "above/below" isn't a false claim worth flagging
  if (dir === "above" && spot < level - TOL) {
    return `CORRECTION  SPX at ${fmt(spot, 0)} is actually BELOW its ${label} ${fmt(level, 0)}, not above it — the read below reflects the real structure.`;
  }
  if (dir === "below" && spot > level + TOL) {
    return `CORRECTION  SPX at ${fmt(spot, 0)} is actually ABOVE its ${label} ${fmt(level, 0)}, not below it — the read below reflects the real structure.`;
  }
  return null;
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

  // Spatial claims about spot vs a named GEX level (call wall / put wall / max pain). The gamma-flip
  // case is already handled above via desk.above_gamma_flip; these cover the wall/max-pain claims the
  // gauntlet's "pinned above its call wall" false premise slipped through. Level values come from the
  // desk's OWN ladder / max_pain, so the correction is grounded in exactly what the read will cite.
  const spot = price;
  const wallChecks: Array<[number | null, string, string]> = [
    [callWallStrike(desk), "call\\s*wall", "call wall"],
    [putWallStrike(desk), "put\\s*wall", "put wall"],
    [desk.max_pain, "max\\s?pain", "max pain"],
  ];
  for (const [level, levelRe, label] of wallChecks) {
    const line = levelClaimCorrection(q, spot, level, levelRe, label);
    if (line) out.push(line);
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
