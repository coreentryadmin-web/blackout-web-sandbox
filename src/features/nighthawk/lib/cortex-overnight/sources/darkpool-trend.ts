// OVERNIGHT CORTEX SOURCE: darkpool-trend — institutional accumulation direction.
//
// Forensic basis (NIGHTHAWK-OVERNIGHT-DECISION.md §3.4, "Dark pool"): multi-day
// dark-pool print direction vs the play direction. Institutions accumulating WITH the
// play (bullish prints under a long) is confirmation; accumulating AGAINST it is the
// smart-money-fade warning an overnight hold most needs to hear. Asymmetric like the
// rest of the lens: confirmation is a modest support, opposition is a heavier oppose
// (a fade against dealer/institutional flow is the kind of thing that gaps a next-day
// play through its stop). "Levels without size context are decoration" (§3.3) — a
// neutral/mixed/low-conviction tape says nothing (absent), never a fabricated lean.

import type { OvernightInputs, OvernightEvidenceItem } from "../types";
import { absentForMissingSlice, fmtMillions, fmtNum } from "./shared";

/** Support weight when dark-pool bias aligns with the play. Capped small — dark-pool
 *  confluence is a confirmation garnish, never a standalone reason to publish. */
export const DARKPOOL_ALIGNED_SUPPORT_WEIGHT = 0.5;

/** Per-source support cap. */
export const DARKPOOL_TREND_SUPPORT_CAP = 0.5;

/** Oppose weight when dark-pool bias fights the play — deliberately heavier than the
 *  aligned support (asymmetry: a smart-money fade against an overnight hold is a
 *  louder warning than confirmation is an edge). */
export const DARKPOOL_OPPOSED_OPPOSE_WEIGHT = 0.7;

/** A ticker's dark-pool tape must carry at least this much total premium to be
 *  structural rather than decoration (§3.3). */
export const DARKPOOL_MIN_TOTAL_PREMIUM = 5_000_000;

export function deriveDarkPoolTrendEvidence(input: OvernightInputs): OvernightEvidenceItem[] {
  const { darkPool, direction } = input;
  if (!darkPool) return [absentForMissingSlice("darkpool-trend", input, "no dark-pool read for the ticker")];
  if (darkPool.totalPremium < DARKPOOL_MIN_TOTAL_PREMIUM) {
    return [
      absentForMissingSlice(
        "darkpool-trend",
        input,
        `dark-pool tape below the ${fmtMillions(DARKPOOL_MIN_TOTAL_PREMIUM)} structural floor (${fmtMillions(darkPool.totalPremium)}) — decoration, not signal`
      ),
    ];
  }
  if (darkPool.bias !== "bullish" && darkPool.bias !== "bearish") {
    return [absentForMissingSlice("darkpool-trend", input, `dark-pool bias ${darkPool.bias} — no directional accumulation to compare against the play`)];
  }

  const aligned = (direction === "long" && darkPool.bias === "bullish") || (direction === "short" && darkPool.bias === "bearish");
  const split = `${fmtMillions(darkPool.callPremium)} call vs ${fmtMillions(darkPool.putPremium)} put of ${fmtMillions(darkPool.totalPremium)}`;

  if (aligned) {
    return [
      {
        source: "darkpool-trend",
        stance: "supports",
        weight: DARKPOOL_ALIGNED_SUPPORT_WEIGHT,
        asOf: darkPool.asOf,
        detail: `dark-pool accumulation is ${darkPool.bias}, aligned with the ${direction} play (${split}) — institutional confirmation.`,
      },
    ];
  }
  return [
    {
      source: "darkpool-trend",
      stance: "opposes",
      weight: DARKPOOL_OPPOSED_OPPOSE_WEIGHT,
      asOf: darkPool.asOf,
      detail:
        `dark-pool accumulation is ${darkPool.bias}, AGAINST the ${direction} play (${split}) — ` +
        `institutions leaning the other way into the hold (smart-money fade). PCR-style split ${fmtNum(darkPool.putPremium / Math.max(1, darkPool.callPremium))}.`,
    },
  ];
}
