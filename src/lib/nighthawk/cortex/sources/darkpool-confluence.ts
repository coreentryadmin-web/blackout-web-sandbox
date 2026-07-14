// CORTEX SOURCE: dark-pool × wall confluence — a BONUS, never standalone.
// Design doc §1 "Dark pool levels", verbatim: "confluence bonus only (never
// standalone): wall + dark-pool level within 0.1× EM of each other strengthens the
// wallPathCheck verdict." "Lies when: levels without size context are decoration" —
// so only levels that carry real accumulated premium count, and only when the
// wallPathCheck actually produced a SUPPORTING wall to strengthen. A dark-pool
// level near the BLOCKING wall needs no bonus: the veto channel is already
// unbounded (design §0), so hardening a block adds nothing but noise.

import type { CortexInputs, EvidenceItem } from "../types";
import { wallPathCheck } from "./gex-walls";
import { absentForMissingSlice, fmtMillions, fmtNum } from "./shared";

/** 0.1× EM confluence radius — design §1 verbatim. */
export const DARKPOOL_CONFLUENCE_EM_FRAC = 0.1;

/** Raw bonus weight 0.4 — the smallest tier: this source can only ever STRENGTHEN
 *  an existing structural support (never originate one), so it is sized as a
 *  garnish on the 1.0 gex-walls unit, not a signal of its own. */
export const DARKPOOL_BONUS_WEIGHT = 0.4;

/** Per-source support cap (one confluence bonus max). */
export const DARKPOOL_SUPPORT_CAP = 0.4;

/** A level must carry ≥$5M of accumulated dark-pool premium to be structural —
 *  "levels without size context are decoration" (design §1); institutional
 *  reference levels on liquid 0DTE names accumulate tens of millions. */
export const DARKPOOL_MIN_PREMIUM = 5_000_000;

/** Half-life 60 min — the slowest intraday clock on the board: dark-pool levels are
 *  session-scale institutional references, not tick-scale signals. */
export const DARKPOOL_HALF_LIFE_SEC = 60 * 60;

export function deriveDarkPoolConfluenceEvidence(input: CortexInputs): EvidenceItem[] {
  const { darkPool, expectedMovePts: em } = input;
  if (!darkPool) return [absentForMissingSlice("darkpool-confluence", input, "no dark-pool levels")];
  if (em == null || em <= 0) {
    return [absentForMissingSlice("darkpool-confluence", input, "no expected move to scale confluence distance")];
  }

  const { supportingWall } = wallPathCheck(input);
  if (!supportingWall) {
    // Bonus only (design §1): with no same-side supporting wall there is nothing to
    // strengthen — a dark-pool level alone must never move the score.
    return [absentForMissingSlice("darkpool-confluence", input, "no supporting wall to confirm (bonus-only source)")];
  }

  const radius = em * DARKPOOL_CONFLUENCE_EM_FRAC;
  const confluent = darkPool.levels
    .filter((l) => l.premium >= DARKPOOL_MIN_PREMIUM)
    .map((l) => ({ ...l, distance: Math.abs(l.price - supportingWall.strike) }))
    .filter((l) => l.distance <= radius)
    // Deterministic pick: nearest first, then larger premium.
    .sort((a, b) => a.distance - b.distance || b.premium - a.premium)[0];

  if (!confluent) {
    return [
      absentForMissingSlice(
        "darkpool-confluence",
        input,
        `no sized dark-pool level within 0.1x expected move (${fmtNum(radius)} pts) of the supporting wall`
      ),
    ];
  }

  return [
    {
      source: "darkpool-confluence",
      stance: "supports",
      weight: DARKPOOL_BONUS_WEIGHT,
      halfLifeSec: DARKPOOL_HALF_LIFE_SEC,
      asOf: darkPool.asOf,
      detail:
        `dark-pool level ${fmtNum(confluent.price)} (${fmtMillions(confluent.premium)} printed) sits ` +
        `${fmtNum(confluent.distance)} pts from the supporting wall ${fmtNum(supportingWall.strike)} ` +
        `(inside 0.1x expected move = ${fmtNum(radius)} pts) — institutional confluence strengthens the wall.`,
    },
  ];
}
