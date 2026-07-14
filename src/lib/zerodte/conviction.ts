// 0DTE conviction display cap (C-1) — the ONE shared helper every member-facing
// surface routes conviction letters through before rendering.
//
// WHY: the A+ band (dossier score ≥ 70 / cortex 85+ tier) is under an open
// calibration investigation — on every surface that has graded data the A+ tier
// is MIS-calibrated (the "highest conviction" band does not outperform A; see
// NIGHTHAWK-0DTE-DECISION.md F-5 / C-1). Until ≥30 sessions of calibration data
// clear or re-band it, no member surface may display a band above "A": showing a
// member "A+" implies a measured edge tier the data does not currently support.
// The underlying score/letter is NOT mutated anywhere else — the ledger keeps the
// scorer's raw letter so the calibration loop can still measure the A+ band; only
// the DISPLAY is capped, in this one place, so the cap can be lifted by deleting
// one branch when the investigation closes.

/** The strongest conviction letter member surfaces may display while C-1 is open. */
export const ZERODTE_CONVICTION_DISPLAY_CAP = "A";

/**
 * Cap a raw conviction letter for display. "A+" (any casing/whitespace) renders
 * as "A"; every other value passes through untouched (including null — an absent
 * conviction stays absent, never fabricated).
 */
export function capConvictionDisplay(conviction: string | null | undefined): string | null {
  if (conviction == null) return null;
  const trimmed = conviction.trim();
  if (trimmed === "") return null;
  return trimmed.toUpperCase() === "A+" ? ZERODTE_CONVICTION_DISPLAY_CAP : trimmed;
}
