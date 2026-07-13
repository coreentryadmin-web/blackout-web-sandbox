/**
 * Vector feature — public surface for pages and API routes.
 * UI + server logic colocated under src/features/vector/.
 */

export { VectorPageShell } from "./components/VectorPageShell";
export type { VectorBar } from "./components/VectorChart";

export { fetchVectorSeedBars } from "./lib/vector-seed-bars";
export { normalizeVectorTicker, isVectorTickerAllowed, VECTOR_DEFAULT_TICKER } from "./lib/vector-ticker";
export {
  buildVectorStreamPayload,
  getVectorDarkPoolLevels,
  getVectorGammaFlip,
  getVectorGexWalls,
  getVectorGexWallsForHorizon,
  getVectorVexFlip,
  getVectorVexWalls,
  getVectorWallHistory,
  primeVectorWallScope,
} from "./lib/vector-snapshot";
export {
  type VectorDteHorizon,
  VECTOR_DTE_HORIZONS,
  VECTOR_DEFAULT_DTE_HORIZON,
  dteHorizonLabel,
  normalizeDteHorizon,
  expiriesForHorizon,
} from "./lib/vector-dte-horizon";
export {
  loadVectorUniverseSnapshot,
  refreshVectorUniverseSnapshot,
  type VectorUniverseRow,
  type VectorUniverseSnapshot,
} from "./lib/vector-universe";
export { buildCoachingAlerts } from "./lib/vector-coaching";
export { fetchSpyVolumeRows } from "./lib/vector-spy-volume";
export {
  backfillRailPrefix,
  decimateWallHistory,
  mergeModeledUnderlay,
  mergeWallHistory,
  PRIOR_SESSION_DECIMATION_STEP_SEC,
  seedWallHistoryForDisplay,
  type VectorWallLens,
  type WallHistorySample,
} from "./lib/vector-wall-history";
export type { VectorTimeframeMinutes } from "./lib/vector-bar-timeframes";
export { loadMultiSessionWallHistory, loadSessionWallHistory } from "./lib/vector-wall-persist";
export { reconstructSessionRail, reconstructSessionHeatmap } from "./lib/vector-gex-reconstruct-server";
export type { GexHeatmapGrid } from "./lib/vector-gex-reconstruct";
