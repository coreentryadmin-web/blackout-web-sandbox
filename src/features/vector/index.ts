/**
 * Vector feature — public surface for pages and API routes.
 * UI + server logic colocated under src/features/vector/.
 */

export { VectorPageShell } from "./components/VectorPageShell";
export type { VectorBar } from "./components/VectorChart";

export { fetchVectorSeedBars } from "./lib/vector-seed-bars";
export {
  buildVectorStreamPayload,
  getVectorDarkPoolLevels,
  getVectorGammaFlip,
  getVectorGexWalls,
  getVectorVexFlip,
  getVectorVexWalls,
  getVectorWallHistory,
  primeVectorWallScope,
} from "./lib/vector-snapshot";
export { fetchSpyVolumeRows } from "./lib/vector-spy-volume";
export {
  mergeWallHistory,
  seedWallHistoryForDisplay,
  type VectorWallLens,
  type WallHistorySample,
} from "./lib/vector-wall-history";
export type { VectorTimeframeMinutes } from "./lib/vector-bar-timeframes";
export { loadSessionWallHistory } from "./lib/vector-wall-persist";
