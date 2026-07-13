// CORTEX SOURCE: VEX direction + the documented charm HEURISTIC.
// Design doc §1 "VEX/DEX/charm" debate verdict, verbatim: "integrate VEX now (lens
// exists), model charm as a time-of-day × pin-distance heuristic until real charm
// ships. No fake charm numbers."
//
//  - VEX: net dealer dollar-vanna says whether vol moves help or hurt dealers.
//    Sign convention (gex-positioning.ts): net VEX NEGATIVE → a vol spike forces
//    dealer de-hedging (selling pressure) → aligns with a SHORT; net VEX POSITIVE →
//    vol-driven dealer buying / IV-bleed support → aligns with a LONG. Small weight
//    either way (design: "VEX-supportive vol direction → small support").
//  - CHARM: ⚠️ HEURISTIC ONLY until the real charm lens ships (task #24). No greek
//    values are computed or quoted — the ONLY inputs are the clock (≥14:30 ET, when
//    charm-driven delta decay dominates expiry afternoons) and pin distance (spot
//    within 0.3× EM of the king node). A long-premium play inside that pin zone
//    after 14:30 bleeds even when directionally right → oppose (design §1 0DTE use).

import type { CortexInputs, EvidenceItem } from "../types";
import { absentForMissingSlice, etMinutesOfDay, fmtNum, parseMs } from "./shared";

/** Raw weight of VEX direction alignment. 0.4 — the smallest tier on the board:
 *  second-order-greek direction from sparse 0DTE chains is the noisiest input the
 *  design still considered worth integrating ("small support"). Symmetric on
 *  oppose: a vol path that fights the play is the same-size headwind. */
export const VEX_ALIGN_WEIGHT = 0.4;

/** Per-source support cap (VEX support is the only support this source emits). */
export const VEX_CHARM_SUPPORT_CAP = 0.4;

/** Charm pin-risk oppose weight. 0.6 — above VEX (the afternoon pin effect is the
 *  best-documented expiry mechanic in the design's debate) but below the earnings
 *  oppose: it is still a heuristic, not a measured greek. */
export const CHARM_PIN_OPPOSE_WEIGHT = 0.6;

/** 14:30 ET — the design's own boundary ("long premium in a charm-pinned tape after
 *  ~14:30 bleeds even when right", §1). Minutes-of-day in ET. */
export const CHARM_AFTERNOON_START_ET_MIN = 14 * 60 + 30;

/** 0.3× EM pin radius around the king node — design §1 0DTE use, verbatim
 *  ("afternoon long-premium plays within 0.3× EM of the king node → oppose"). */
export const CHARM_PIN_EM_FRAC = 0.3;

/** Half-life 20 min: vanna posture rotates with the vol surface — slower than the
 *  wall trend, faster than sector rotation. */
export const VEX_CHARM_HALF_LIFE_SEC = 20 * 60;

export function deriveVexCharmEvidence(input: CortexInputs): EvidenceItem[] {
  const { vex, direction, spot, expectedMovePts: em } = input;
  if (!vex) return [absentForMissingSlice("vex-charm", input, "no dealer positioning matrix (VEX unavailable)")];
  const nowMs = parseMs(input.now);
  if (nowMs == null) return [absentForMissingSlice("vex-charm", input, "invalid now timestamp")];

  const items: EvidenceItem[] = [];
  const base = { source: "vex-charm" as const, halfLifeSec: VEX_CHARM_HALF_LIFE_SEC, asOf: vex.asOf };

  // --- VEX direction ---------------------------------------------------------
  if (vex.netVex != null && vex.netVex !== 0) {
    const vexAligns = vex.netVex < 0 ? direction === "short" : direction === "long";
    items.push({
      ...base,
      stance: vexAligns ? "supports" : "opposes",
      weight: VEX_ALIGN_WEIGHT,
      detail:
        `net dealer VEX is ${vex.netVex < 0 ? "negative (vol-up forces dealer selling)" : "positive (vol path favors dealer buying)"} — ` +
        `${vexAligns ? "aligned with" : "fights"} a ${direction}.`,
    });
  }

  // --- Charm pin-distance heuristic (documented, no fabricated greeks) --------
  // Both play directions are premium BUYS on 0DTE Command (fixed option plan), so
  // the pin-bleed opposition is direction-agnostic: a pinned tape kills the premium
  // whichever way the contract points.
  if (vex.kingStrike != null && spot != null && em != null && em > 0) {
    const pinDistance = Math.abs(spot - vex.kingStrike);
    const pinRadius = em * CHARM_PIN_EM_FRAC;
    if (etMinutesOfDay(nowMs) >= CHARM_AFTERNOON_START_ET_MIN && pinDistance <= pinRadius) {
      items.push({
        ...base,
        stance: "opposes",
        weight: CHARM_PIN_OPPOSE_WEIGHT,
        // The claim is about THIS instant's clock + distance — asOf is the snapshot now.
        asOf: input.now,
        detail:
          `charm pin-risk heuristic: after 14:30 ET with spot ${fmtNum(spot)} only ${fmtNum(pinDistance)} pts ` +
          `from king node ${fmtNum(vex.kingStrike)} (inside 0.3x expected move = ${fmtNum(pinRadius)} pts) — ` +
          `long premium bleeds into the pin (heuristic until the real charm lens ships).`,
      });
    }
  }

  if (items.length === 0) {
    return [absentForMissingSlice("vex-charm", input, "VEX flat/absent and no afternoon pin condition")];
  }
  return items;
}
