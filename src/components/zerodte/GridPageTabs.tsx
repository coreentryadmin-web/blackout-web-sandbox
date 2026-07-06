"use client";

import { useState } from "react";
import { Tabs, TabList, Tab, TabPanels, TabPanel } from "@/components/ui";
import { ZeroDteBoard } from "./ZeroDteBoard";
import { GridBoard } from "@/components/grid/GridBoard";
import { GridSearchBar } from "@/components/grid/GridSearchBar";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";

/**
 * /grid: admins see 0DTE Command + Market Grid tabs; premium users with `grid` launched
 * see 0DTE Command + Market Grid tabs; Largo on /terminal stays gated.
 * tab keeps its own search bar so the ticker-filter workflow is unchanged. Panels stay
 * unmounted until first visit — the classic Grid's polling/SSE only starts if opened.
 */
type GridBoardTab = "command" | "classic";

export function GridPageTabs({ showZeroDteCommand = false }: { showZeroDteCommand?: boolean }) {
  const nativeShell = useIosNativeShell();
  const [nativeTab, setNativeTab] = useState<GridBoardTab>("command");

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

  if (nativeShell) {
    return (
      <div className="grid-page-tabs grid-page-tabs-native">
        <IosNativeSegment
          value={nativeTab}
          onChange={setNativeTab}
          accent="#ffcc4d"
          aria-label="Grid boards"
          className="ios-native-desk-segment"
          segments={[
            { id: "command", label: "0DTE Command" },
            { id: "classic", label: "Market Grid" },
          ]}
        />
        <div className="grid-page-tabs-native-panel">
          {nativeTab === "command" ? (
            <ZeroDteBoard />
          ) : (
            <>
              <div className="mb-4 flex justify-end">
                <GridSearchBar />
              </div>
              <GridBoard />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <Tabs defaultValue="command" className="grid-page-tabs">
      <TabList aria-label="Grid boards" className="w-full sm:max-w-fit">
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
