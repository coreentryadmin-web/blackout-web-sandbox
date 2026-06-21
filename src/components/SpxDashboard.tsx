"use client";

import React from "react";
import { useMergedDesk } from "@/hooks/useMergedDesk";
import { SpxSniperHeader } from "@/components/desk/SpxSniperHeader";
import { SpxCommentaryRail } from "@/components/desk/SpxCommentaryRail";
import { SpxTradeAlerts } from "@/components/desk/SpxTradeAlerts";
import {
  SpxGexLadder,
  SpxIntelStrip,
  SpxUnifiedTape,
} from "@/components/desk/SpxDeskPanels";
import { SpxDayPerformancePanel } from "@/components/desk/SpxDayPerformancePanel";

class SpxPanelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError)
      return (
        <div className="text-red-400 p-4 text-xs font-mono">
          Panel error — refresh to retry
        </div>
      );
    return this.props.children;
  }
}

export function SpxDashboard() {
  const { desk, live, refreshing, deskLoading, sessionActive } = useMergedDesk();

  if (deskLoading && !desk) {
    return (
      <div className="spx-sniper-desk spx-sniper-desk-loading" aria-busy="true">
        <div className="spx-desk-skeleton" />
      </div>
    );
  }

  return (
    <div className="spx-sniper-desk">
      <SpxPanelErrorBoundary>
        <SpxSniperHeader desk={desk} live={live} />
      </SpxPanelErrorBoundary>

      <SpxPanelErrorBoundary>
        <SpxIntelStrip desk={desk} live={live} />
      </SpxPanelErrorBoundary>

      <div className="spx-sniper-triple">
        <SpxPanelErrorBoundary>
          <aside className="spx-sniper-left-rail spx-left-stack">
            <SpxDayPerformancePanel />
            <SpxGexLadder desk={desk} live={live} refreshing={refreshing} />
            <SpxUnifiedTape desk={desk} live={live} refreshing={refreshing} />
          </aside>
        </SpxPanelErrorBoundary>

        <SpxPanelErrorBoundary>
          <div className="spx-sniper-chart-col spx-center-stack">
            <SpxTradeAlerts desk={desk} live={live} refreshing={refreshing} sessionActive={sessionActive} />
          </div>
        </SpxPanelErrorBoundary>

        <SpxPanelErrorBoundary>
          <SpxCommentaryRail desk={desk} live={live} />
        </SpxPanelErrorBoundary>
      </div>
    </div>
  );
}
