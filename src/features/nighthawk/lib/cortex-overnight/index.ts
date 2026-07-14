// NIGHT HAWK CORTEX — OVERNIGHT lens: barrel (PR-N5).
//
// Consumers (the edition builder) import from here:
//   const inputs = await buildOvernightInputs({ play, dossier, ctx, now, horizonDate });
//   const verdict = composeOvernightEvidence(inputs);
//   if (verdict.verdict === "VETO") { /* persist nighthawk_rejected, do not publish */ }
//   // pin verdict into publish_context.cortex_overnight for the Debrief/calibration.

export type {
  OvernightDirection,
  OvernightStance,
  OvernightSourceId,
  OvernightSourceFn,
  OvernightEvidenceItem,
  OvernightVerdict,
  OvernightVerdictTag,
  OvernightInputs,
  OvernightCatalystSlice,
  OvernightWallSlice,
  OvernightWallSample,
  OvernightDarkPoolSlice,
  OvernightIvSlice,
  OvernightSectorSlice,
  OvernightFlowSlice,
  OvernightBinaryEvent,
  OvernightWall,
  EarningsReportTime,
} from "./types";
export { OVERNIGHT_SOURCES } from "./types";

export { composeOvernightEvidence, WEAK_MAX_SCORE, OVERNIGHT_SUPPORT_CAPS } from "./compose";

export {
  buildOvernightInputs,
  detectCatalystPlay,
  normalizeDirection,
  parseWallStrike,
  sectorChangeFor,
  latestFlowTimestamp,
  type BuildOvernightInputsArgs,
  type OvernightBuildCtx,
} from "./build-inputs";
