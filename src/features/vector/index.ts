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
  mergeModeledUnderlay,
  mergeWallHistory,
  seedWallHistoryForDisplay,
  type VectorWallLens,
  type WallHistorySample,
} from "./lib/vector-wall-history";
export type { VectorTimeframeMinutes } from "./lib/vector-bar-timeframes";
export { loadSessionWallHistory } from "./lib/vector-wall-persist";
export { loadVectorSeedProps, type VectorSeedProps } from "./lib/vector-seed-props";
export { reconstructSessionRail, reconstructSessionHeatmap } from "./lib/vector-gex-reconstruct-server";
export type { GexHeatmapGrid } from "./lib/vector-gex-reconstruct";
