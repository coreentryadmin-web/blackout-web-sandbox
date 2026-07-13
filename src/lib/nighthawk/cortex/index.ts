// NIGHT HAWK CORTEX — barrel (PR-A: core only; the gate-stack wire-in, entry_context
// persistence and calibration job are PR-B/PR-C — see NIGHTHAWK-CORTEX-DESIGN.md §4).
//
// Consumers (0DTE Command, the edition builder, the hunt UI, BIE) import from here:
//   const inputs = await fetchCortexInputs(ticker, direction);
//   const verdict = composeCortexEvidence(inputs);

export type {
  CortexConviction,
  CortexDirection,
  CortexDarkPoolSlice,
  CortexFlowPrint,
  CortexFlowPrintKind,
  CortexFlowSlice,
  CortexGexSlice,
  CortexInputs,
  CortexNewsItem,
  CortexNewsSlice,
  CortexSectorSlice,
  CortexSourceFn,
  CortexSourceId,
  CortexVerdict,
  CortexVexSlice,
  CortexWall,
  CortexWallTrendSample,
  CortexWallTrendSlice,
  EvidenceItem,
} from "./types";
export { CORTEX_SOURCES } from "./types";

export {
  composeCortexEvidence,
  cortexDecayFactor,
  ABSENT_AFTER_HALF_LIVES,
  CONVICTION_A_MIN_SCORE,
  CONVICTION_B_MIN_SCORE,
  SOURCE_SUPPORT_CAPS,
} from "./compose";

export { fetchCortexInputs, CORTEX_SOURCE_TIMEOUT_MS, type CortexFetchDeps } from "./fetch";
