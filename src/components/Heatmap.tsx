"use client";

import { GexHeatmap } from "@/components/desk/GexHeatmap";

/**
 * /heatmap is the GEX positioning tool: regime header + gamma profile (with a
 * Profile|Matrix toggle inside GexHeatmap). The legacy GEX|Sectors switch and the
 * sector thermal / movers view were removed — those source components still exist
 * (used by other tools) but no longer render here.
 *
 * The "BlackOut Data Desk · live" EngineStatusBar sub-bar was removed (UI refactor):
 * it duplicated the in-panel Live/Quote-only badge + spot, and the engine still
 * surfaces its status there. The component file is kept for other desks.
 */
export function Heatmap() {
  return (
    <div className="desk-layout space-y-5">
      <GexHeatmap ticker="SPY" />
    </div>
  );
}
