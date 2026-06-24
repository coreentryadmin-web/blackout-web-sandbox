"use client";

import { EngineStatusBar } from "@/components/desk/EngineStatusBar";
import { GexHeatmap } from "@/components/desk/GexHeatmap";

/**
 * /heatmap is the GEX positioning tool: regime header + gamma profile (with a
 * Profile|Matrix toggle inside GexHeatmap). The legacy GEX|Sectors switch and the
 * sector thermal / movers view were removed — those source components still exist
 * (used by other tools) but no longer render here.
 */
export function Heatmap() {
  return (
    <div className="desk-layout space-y-5">
      <EngineStatusBar />
      <GexHeatmap ticker="SPY" />
    </div>
  );
}
