// CORTEX SOURCE: Vector GEX ladder — walls, path geometry, regime style.
// Design doc §1 "Vector GEX ladder": the dealer landscape the trade must traverse.
//  - wallPathCheck VETO: the play's target path crosses an opposing DOMINANT wall
//    within 0.5× expected move — a long into a call wall inside the EM is buying
//    into a sell-hedging zone (and mirrored for shorts into put walls).
//  - wallPathCheck SUPPORT: entering off a same-side wall ≤0.25× EM behind entry —
//    a bounce off a defended wall with structure at your back.
//  - Regime-style mismatch: a momentum commit in a long-gamma (mean-reverting) tape
//    is an OPPOSE, not a veto (design: "calibrate first"). Every 0DTE Command commit
//    is momentum-style by construction — the scanner follows flow aggression
//    (NIGHTHAWK-VS-SLAYER-0DTE.md §1.2) — so posture "long" opposes any direction.

import type { CortexInputs, CortexWall, EvidenceItem } from "../types";
import { absentForMissingSlice, fmtNum } from "./shared";

/** 0.5× EM: the block radius for an opposing dominant wall on the target path —
 *  design §1 verbatim ("BLOCK if the play's target path crosses an opposing
 *  dominant wall within 0.5× expected move"). */
export const WALL_PATH_BLOCK_EM_FRAC = 0.5;

/** 0.25× EM: how close behind entry a same-side wall must sit to count as structural
 *  support — design §1 verbatim ("SUPPORT if entering off a same-side wall ≤0.25× EM
 *  behind entry"). */
export const WALL_ENTRY_SUPPORT_EM_FRAC = 0.25;

/** Raw weight of the same-side-wall support. 1.0 = the reference unit of the whole
 *  weight scale: dealer-structure path support is the baseline "structurally sound"
 *  signal every other source's weight is sized against (design §1 lists the ladder
 *  first for a reason — it is the landscape, not a flavor). */
export const GEX_WALLS_SUPPORT_WEIGHT = 1.0;

/** Per-source support cap (design §0: supporting evidence is capped per source).
 *  Equal to the single support weight — this source has exactly one way to support,
 *  so the cap documents the bound rather than changing behaviour. */
export const GEX_WALLS_SUPPORT_CAP = 1.0;

/** Regime-style mismatch weight — deliberately below the support unit because the
 *  design explicitly demotes it to "oppose, not veto (calibrate first)" (§1): the
 *  mismatch is a style headwind, not a structural block. */
export const REGIME_STYLE_OPPOSE_WEIGHT = 0.6;

/** Half-life 15 min: post-a63f162 walls blend OI + dayVolume, so the ladder is an
 *  intraday-moving read (design §1 "lies when: OI-derived walls are stale intraday");
 *  15 min matches the order of the desk's own flow-staleness tolerances rather than
 *  pretending a wall read is good for a whole session. */
export const GEX_WALLS_HALF_LIFE_SEC = 15 * 60;

/** The wallPathCheck geometry, shared with darkpool-confluence (which only ever
 *  STRENGTHENS this verdict — design §1 dark pool: "confluence bonus only"). Returns
 *  the opposing dominant wall if it blocks the path, and the same-side wall if it
 *  supports the entry. Walls are ranked strongest-first, so [0] is "dominant". */
export function wallPathCheck(input: CortexInputs): {
  blockingWall: CortexWall | null;
  supportingWall: CortexWall | null;
} {
  const { gex, spot, expectedMovePts: em, direction } = input;
  if (!gex || spot == null || em == null || em <= 0) {
    return { blockingWall: null, supportingWall: null };
  }
  // Opposing dominant wall: for a long the strongest CALL wall ABOVE spot (the
  // sell-hedging zone the target path runs into); for a short the strongest PUT
  // wall BELOW spot. Same-side wall: the mirror image behind the entry.
  const opposing = direction === "long" ? gex.callWalls[0] : gex.putWalls[0];
  const sameSide = direction === "long" ? gex.putWalls[0] : gex.callWalls[0];

  const ahead = (w: CortexWall) => (direction === "long" ? w.strike - spot : spot - w.strike);
  const behind = (w: CortexWall) => (direction === "long" ? spot - w.strike : w.strike - spot);

  const blockingWall =
    opposing && ahead(opposing) > 0 && ahead(opposing) <= em * WALL_PATH_BLOCK_EM_FRAC
      ? opposing
      : null;
  const supportingWall =
    sameSide && behind(sameSide) > 0 && behind(sameSide) <= em * WALL_ENTRY_SUPPORT_EM_FRAC
      ? sameSide
      : null;
  return { blockingWall, supportingWall };
}

export function deriveGexWallsEvidence(input: CortexInputs): EvidenceItem[] {
  const { gex, spot, expectedMovePts: em, direction } = input;
  if (!gex) return [absentForMissingSlice("gex-walls", input, "no GEX ladder for the 0DTE horizon")];
  if (spot == null) return [absentForMissingSlice("gex-walls", input, "no live spot")];
  if (em == null || em <= 0) {
    return [absentForMissingSlice("gex-walls", input, "no expected move to scale wall distances")];
  }
  if (gex.callWalls.length === 0 && gex.putWalls.length === 0) {
    // The honest-gap rule (design §1 "lies when: one-sided thin chains fabricate
    // geometry"): an empty ladder is a can't-answer, never a neutral pass.
    return [absentForMissingSlice("gex-walls", input, "GEX ladder has no wall nodes")];
  }

  const items: EvidenceItem[] = [];
  const { blockingWall, supportingWall } = wallPathCheck(input);
  const opposingSide = direction === "long" ? "call" : "put";
  const sameSide = direction === "long" ? "put" : "call";
  const base = { source: "gex-walls" as const, halfLifeSec: GEX_WALLS_HALF_LIFE_SEC, asOf: gex.asOf };

  if (blockingWall) {
    items.push({
      ...base,
      stance: "veto",
      // Vetoes are unbounded by design (§0); the weight records how loud this one is
      // relative to the support unit, for the evidence table only — the block is binary.
      weight: GEX_WALLS_SUPPORT_WEIGHT,
      detail:
        `${direction} target path crosses dominant ${opposingSide} wall ${fmtNum(blockingWall.strike)} ` +
        `(${fmtNum(blockingWall.pct)}% of ladder gamma) ${fmtNum(Math.abs(blockingWall.strike - spot))} pts ` +
        `${direction === "long" ? "above" : "below"} spot ${fmtNum(spot)}, inside 0.5x expected move ` +
        `(${fmtNum(em * WALL_PATH_BLOCK_EM_FRAC)} pts).`,
    });
  }

  if (supportingWall) {
    items.push({
      ...base,
      stance: "supports",
      weight: GEX_WALLS_SUPPORT_WEIGHT,
      detail:
        `entry sits off same-side ${sameSide} wall ${fmtNum(supportingWall.strike)} ` +
        `(${fmtNum(supportingWall.pct)}% of ladder gamma) ${fmtNum(Math.abs(supportingWall.strike - spot))} pts ` +
        `${direction === "long" ? "below" : "above"} spot ${fmtNum(spot)}, within 0.25x expected move ` +
        `(${fmtNum(em * WALL_ENTRY_SUPPORT_EM_FRAC)} pts).`,
    });
  }

  // Regime-style match. Long-gamma tape mean-reverts (fade edges); a momentum-style
  // 0DTE commit there fights the pin — oppose, not veto (design §1: calibrate first).
  if (gex.regimePosture === "long") {
    items.push({
      ...base,
      stance: "opposes",
      weight: REGIME_STYLE_OPPOSE_WEIGHT,
      detail:
        `momentum-style ${direction} in a long-gamma tape` +
        (gex.gammaFlip != null
          ? ` (spot ${fmtNum(spot)} above flip ${fmtNum(gex.gammaFlip)})`
          : "") +
        ` — mean-reversion regime opposes trend-following entries.`,
    });
  }

  if (items.length === 0) {
    // The ladder answered — the geometry is simply neutral for this play. Say so
    // (a source that ran and found nothing notable is NOT absent; the verdict's
    // evidence table should show the check happened).
    items.push({
      ...base,
      stance: "supports",
      weight: 0,
      detail: `no dominant wall inside 0.5x expected move of the ${direction} path; regime style compatible.`,
    });
  }
  return items;
}
