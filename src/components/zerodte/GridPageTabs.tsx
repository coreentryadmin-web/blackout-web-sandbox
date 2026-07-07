"use client";

import { GridBoard } from "@/components/grid/GridBoard";
import { GridSearchBar } from "@/components/grid/GridSearchBar";

/**
 * /grid: the classic Market Grid board — news/flow/analysts/GEX/movers/earnings/
 * dark-pool/congress/macro/catalysts/sector-heat panels. 0DTE Command moved to
 * /nighthawk (it now shares Night Hawk's launch gate); this page is single-board only.
 */
export function GridPageTabs() {
  return (
    <>
      <div className="mb-4 flex justify-end">
        <GridSearchBar />
      </div>
      <GridBoard />
    </>
  );
}
