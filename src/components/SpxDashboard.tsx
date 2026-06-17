"use client";

import { useMergedDesk } from "@/hooks/useMergedDesk";
import { SpxSniperHeader } from "@/components/desk/SpxSniperHeader";
import { SpxCommentaryRail } from "@/components/desk/SpxCommentaryRail";
import { SpxTradeAlerts } from "@/components/desk/SpxTradeAlerts";
import {
  SpxDarkPoolCard,
  SpxGexLadder,
  SpxIntelStrip,
  SpxUnifiedTape,
} from "@/components/desk/SpxDeskPanels";

export function SpxDashboard() {
  const { desk, live, refreshing, deskLoading, sessionActive } = useMergedDesk();

  return (
    <div className="spx-sniper-desk">
      <SpxSniperHeader desk={desk} live={live} />

      <SpxIntelStrip desk={desk} live={live} />

      <div className="spx-sniper-triple">
        <aside className="spx-sniper-left-rail spx-left-stack">
          <SpxDarkPoolCard desk={desk} live={live} />
          <SpxGexLadder desk={desk} live={live} refreshing={refreshing} />
          <SpxUnifiedTape desk={desk} live={live} refreshing={refreshing} />
        </aside>

        <div className="spx-sniper-chart-col spx-center-stack">
          <SpxTradeAlerts desk={desk} live={live} refreshing={refreshing} sessionActive={sessionActive} />
        </div>

        <SpxCommentaryRail desk={desk} live={live} />
      </div>
    </div>
  );
}
