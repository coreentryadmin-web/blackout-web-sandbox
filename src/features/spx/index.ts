/**
 * SPX Slayer — dashboard shell, matrix rail, play engine, desk loaders.
 * UI + server logic colocated under src/features/spx/.
 */

export { SpxDashboard } from "./components/SpxDashboard";
export { SignalAnalyticsPanel } from "./components/SignalAnalyticsPanel";
export { SpxGexMatrixHeatmap } from "./components/SpxGexMatrixHeatmap";
export { SpxTradeAlerts } from "./components/SpxTradeAlerts";

export { buildSpxDesk, type SpxDeskPayload } from "./lib/spx-desk";
export { loadMergedSpxDesk } from "./lib/spx-desk-loader";
export { getSpxPlayState } from "./lib/spx-service";
export { evaluateSpxPlay } from "./lib/spx-play-engine";
export { readSpxPlaySnapshot } from "./lib/spx-evaluator";

export { useSpxPlay } from "./hooks/useSpxPlay";
export { useMergedDesk } from "./hooks/useMergedDesk";
