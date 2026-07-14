// OVERNIGHT CORTEX SOURCE: sector-breadth — book-vs-tape alignment.
//
// Forensic basis (NIGHTHAWK-OVERNIGHT-DECISION.md N-4, the "long-only monoculture"):
// "24/26 plays LONG; all 16 July plays LONG. The regime multiplier only SCALES scores
// — nothing flips or vetoes the book on a bearish tape." And N-5 sector crowding:
// "semis took 7 of 14 resolved slots (1W/6L)." A LONG into a bearish SECTOR and/or
// bearish market BREADTH is a NEGATIVE, not a neutral — this source makes that
// explicit at publish. Two independent reads, each an oppose when it fights the play:
//   1. SECTOR heat — the ticker's sector day change vs the play direction.
//   2. Market BREADTH — fraction of names advancing vs the play direction.
// When BOTH fight the play the opposes stack (up to ~1.2) — a real drag toward WEAK
// without being a hard veto (tape posture is context, not a binary event). When both
// align, a modest support. Missing sector+breadth ⇒ absent.

import type { OvernightInputs, OvernightEvidenceItem } from "../types";
import { absentForMissingSlice, fmtNum } from "./shared";

/** A sector day move beyond ±this % is a real directional tone (not chop). */
export const SECTOR_TONE_MIN_PCT = 0.3;

/** Breadth advancing-fraction bands: below LOW = bearish tape, above HIGH = bullish. */
export const BREADTH_BEARISH_FRAC = 0.4;
export const BREADTH_BULLISH_FRAC = 0.6;

/** Oppose weight when the sector fights the play. */
export const SECTOR_OPPOSE_WEIGHT = 0.6;

/** Oppose weight when market breadth fights the play. */
export const BREADTH_OPPOSE_WEIGHT = 0.6;

/** Support weight for an aligned sector OR breadth (each). Capped small. */
export const SECTOR_BREADTH_ALIGNED_SUPPORT_WEIGHT = 0.3;

/** Per-source support cap (aligned sector + aligned breadth may co-emit but never
 *  past this — the tape agreeing is confirmation, not a green light). */
export const SECTOR_BREADTH_SUPPORT_CAP = 0.4;

export function deriveSectorBreadthEvidence(input: OvernightInputs): OvernightEvidenceItem[] {
  const { sector, direction } = input;
  if (!sector) return [absentForMissingSlice("sector-breadth", input, "no sector/breadth read")];

  const items: OvernightEvidenceItem[] = [];
  let anySignal = false;

  // --- Sector heat -----------------------------------------------------------
  if (sector.sectorChangePct != null && Math.abs(sector.sectorChangePct) >= SECTOR_TONE_MIN_PCT) {
    const sectorBullish = sector.sectorChangePct > 0;
    const aligned = (direction === "long" && sectorBullish) || (direction === "short" && !sectorBullish);
    const name = sector.sectorName ?? "sector";
    anySignal = true;
    items.push(
      aligned
        ? {
            source: "sector-breadth",
            stance: "supports",
            weight: SECTOR_BREADTH_ALIGNED_SUPPORT_WEIGHT,
            asOf: sector.asOf,
            detail: `${name} ${fmtNum(sector.sectorChangePct)}% aligns with the ${direction} play — sector tailwind.`,
          }
        : {
            source: "sector-breadth",
            stance: "opposes",
            weight: SECTOR_OPPOSE_WEIGHT,
            asOf: sector.asOf,
            detail: `${name} ${fmtNum(sector.sectorChangePct)}% is AGAINST the ${direction} play — a ${direction} into a ${sectorBullish ? "rising" : "falling"} sector (N-4 monoculture drag).`,
          }
    );
  }

  // --- Market breadth --------------------------------------------------------
  if (sector.breadthAdvancingFrac != null) {
    const frac = sector.breadthAdvancingFrac;
    const bearish = frac <= BREADTH_BEARISH_FRAC;
    const bullish = frac >= BREADTH_BULLISH_FRAC;
    if (bearish || bullish) {
      const tapeBullish = bullish;
      const aligned = (direction === "long" && tapeBullish) || (direction === "short" && !tapeBullish);
      anySignal = true;
      items.push(
        aligned
          ? {
              source: "sector-breadth",
              stance: "supports",
              weight: SECTOR_BREADTH_ALIGNED_SUPPORT_WEIGHT,
              asOf: sector.asOf,
              detail: `market breadth ${fmtNum(frac * 100)}% advancing aligns with the ${direction} play — tape tailwind.`,
            }
          : {
              source: "sector-breadth",
              stance: "opposes",
              weight: BREADTH_OPPOSE_WEIGHT,
              asOf: sector.asOf,
              detail: `market breadth ${fmtNum(frac * 100)}% advancing is AGAINST the ${direction} play — a ${direction} into a ${tapeBullish ? "broadening" : "narrowing/bearish"} tape (N-4).`,
            }
      );
    }
  }

  if (!anySignal) {
    return [absentForMissingSlice("sector-breadth", input, "sector move within chop and breadth mixed — no directional tape read")];
  }
  return items;
}
