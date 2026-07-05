"use client";

import { Tabs, TabList, Tab, TabPanels, TabPanel } from "@/components/ui";
import { ZeroDteBoard } from "./ZeroDteBoard";
import { GridBoard } from "@/components/grid/GridBoard";
import { GridSearchBar } from "@/components/grid/GridSearchBar";

/**
 * /grid: admins see 0DTE Command + Market Grid tabs; premium users with `grid` launched
 * see Market Grid only (0DTE Command is admin preview until LAUNCHED_0DTE=1). The classic
 * tab keeps its own search bar so the ticker-filter workflow is unchanged. Panels stay
 * unmounted until first visit — the classic Grid's polling/SSE only starts if opened.
 */
export function GridPageTabs({ showZeroDteCommand = false }: { showZeroDteCommand?: boolean }) {
  if (!showZeroDteCommand) {
    return (
      <>
        <div className="mb-4 flex justify-end">
          <GridSearchBar />
        </div>
        <GridBoard />
      </>
    );
  }

  return (
    <Tabs defaultValue="command">
      <TabList aria-label="Grid boards" className="max-w-fit">
        <Tab value="command">0DTE Command</Tab>
        <Tab value="classic">Market Grid</Tab>
      </TabList>
      <TabPanels className="mt-4">
        <TabPanel value="command">
          <ZeroDteBoard />
        </TabPanel>
        <TabPanel value="classic">
          <div className="mb-4 flex justify-end">
            <GridSearchBar />
          </div>
          <GridBoard />
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}
