// OVERNIGHT CORTEX SOURCE: iv-term — can the thesis afford the overnight carry.
//
// Forensic basis (NIGHTHAWK-OVERNIGHT-DECISION.md §4.1): "stops are uncapped through
// overnight gaps ... there is no asymmetric payoff plan." A next-day options play pays
// theta AND vega to hold overnight. Two deterministic, already-available reads:
//   1. IV RANK — when it is very high, the entry premium is inflated (buying the top of
//      the vol range) and the overnight vega bleed on any IV mean-reversion is a
//      headwind the move must overcome BEFORE it profits. High IV rank ⇒ oppose.
//   2. TERM STRUCTURE — front IV well ABOVE the next expiry (backwardation) is the
//      market pricing a near-dated event / elevated overnight risk into the front,
//      exactly the premium the overnight hold pays and the gap it is exposed to ⇒
//      oppose. A calm, contango-ish term with modest IV rank ⇒ a small support (cheap
//      carry). Missing IV data ⇒ absent.

import type { OvernightInputs, OvernightEvidenceItem } from "../types";
import { absentForMissingSlice, fmtNum } from "./shared";

/** IV rank above this is "expensive/inflated" — buying near the top of the 1y vol
 *  range. 80 = the top quintile; a deliberately high bar so only genuinely rich vol
 *  opposes a hold (most overnight names sit mid-range and say nothing here). */
export const IV_RANK_EXPENSIVE = 80;

/** IV rank below this is "cheap carry" — a modest support for affording the overnight. */
export const IV_RANK_CHEAP = 30;

/** Front-vs-next IV ratio above this is meaningful backwardation (event priced into the
 *  front). 1.15 = front IV ≥15% richer than the next expiry. */
export const TERM_BACKWARDATION_RATIO = 1.15;

/** Oppose weight for expensive IV rank. */
export const IV_EXPENSIVE_OPPOSE_WEIGHT = 0.5;

/** Oppose weight for backwardated term structure (near-dated event risk priced in). */
export const IV_BACKWARDATION_OPPOSE_WEIGHT = 0.5;

/** Support weight for cheap, calm carry. Capped small. */
export const IV_CHEAP_SUPPORT_WEIGHT = 0.3;

/** Per-source support cap. */
export const IV_TERM_SUPPORT_CAP = 0.3;

export function deriveIvTermEvidence(input: OvernightInputs): OvernightEvidenceItem[] {
  const { iv } = input;
  if (!iv) return [absentForMissingSlice("iv-term", input, "no IV rank / term read for the ticker")];
  if (iv.ivRank == null && iv.term.length < 2) {
    return [absentForMissingSlice("iv-term", input, "neither IV rank nor a two-point term structure available")];
  }

  const items: OvernightEvidenceItem[] = [];
  let anySignal = false;

  // --- IV rank ---------------------------------------------------------------
  if (iv.ivRank != null) {
    if (iv.ivRank >= IV_RANK_EXPENSIVE) {
      anySignal = true;
      items.push({
        source: "iv-term",
        stance: "opposes",
        weight: IV_EXPENSIVE_OPPOSE_WEIGHT,
        asOf: iv.asOf,
        detail: `IV rank ${fmtNum(iv.ivRank)} (top of the range ≥${IV_RANK_EXPENSIVE}) — inflated entry premium and vega bleed on any mean-reversion oppose the overnight hold.`,
      });
    } else if (iv.ivRank <= IV_RANK_CHEAP) {
      anySignal = true;
      items.push({
        source: "iv-term",
        stance: "supports",
        weight: IV_CHEAP_SUPPORT_WEIGHT,
        asOf: iv.asOf,
        detail: `IV rank ${fmtNum(iv.ivRank)} (≤${IV_RANK_CHEAP}) — cheap carry; the overnight theta/vega cost is affordable for the thesis.`,
      });
    }
  }

  // --- Term structure --------------------------------------------------------
  if (iv.term.length >= 2) {
    const front = iv.term[0];
    const next = iv.term[1];
    if (Number.isFinite(front.iv) && Number.isFinite(next.iv) && next.iv > 0) {
      const ratio = front.iv / next.iv;
      if (ratio >= TERM_BACKWARDATION_RATIO) {
        anySignal = true;
        items.push({
          source: "iv-term",
          stance: "opposes",
          weight: IV_BACKWARDATION_OPPOSE_WEIGHT,
          asOf: iv.asOf,
          detail:
            `term structure backwardated: front ${front.expiry} IV ${fmtNum(front.iv)} vs next ${next.expiry} IV ${fmtNum(next.iv)} ` +
            `(${fmtNum(ratio)}× ≥${TERM_BACKWARDATION_RATIO}) — near-dated event risk priced into the premium the hold pays.`,
        });
      }
    }
  }

  if (!anySignal) {
    return [
      absentForMissingSlice(
        "iv-term",
        input,
        `IV rank ${iv.ivRank == null ? "n/a" : fmtNum(iv.ivRank)} mid-range and term structure not backwardated — no overnight-cost edge either way`
      ),
    ];
  }
  return items;
}
