"use client";

import useSWR from "swr";
import { fetchSpxDesk } from "@/lib/api";
import { SpxSniperHeader } from "@/components/desk/SpxSniperHeader";
import { SpxStructureBlocks } from "@/components/desk/SpxStructureBlocks";
import { SpxCommentaryRail } from "@/components/desk/SpxCommentaryRail";
import { SpxChart } from "@/components/desk/SpxChart";
import {
  SpxDarkPoolCard,
  SpxFlowStrip,
  SpxGexLadder,
  SpxIntelStrip,
  SpxIvTermBars,
  SpxNetPremSpark,
  SpxOiChangeStrip,
  SpxUnifiedTape,
} from "@/components/desk/SpxDeskPanels";

const DESK_REFRESH_MS = 5_000;

export function SpxDashboard() {
  const { data: desk, error } = useSWR("spx-desk", fetchSpxDesk, {
    refreshInterval: DESK_REFRESH_MS,
    revalidateOnFocus: true,
  });

  const live = !error && desk?.available === true && (desk?.price ?? 0) > 0;

  return (
    <div className="spx-sniper-desk">
      <SpxSniperHeader desk={desk} live={live} />

      <SpxIntelStrip desk={desk} live={live} />

      <div className="spx-sniper-triple">
        <aside className="spx-sniper-left-rail spx-left-stack">
          <SpxStructureBlocks desk={desk} live={live} variant="left-rail" />
          <SpxDarkPoolCard desk={desk} live={live} />
          <SpxGexLadder desk={desk} live={live} />
        </aside>

        <div className="spx-sniper-chart-col spx-center-stack">
          <SpxChart fill />
          <div className="spx-center-panels">
            <SpxUnifiedTape desk={desk} live={live} />
            <div className="spx-center-panels-row">
              <SpxFlowStrip desk={desk} live={live} />
              <SpxNetPremSpark desk={desk} live={live} />
            </div>
            <div className="spx-center-panels-row">
              <SpxIvTermBars desk={desk} live={live} />
              <SpxOiChangeStrip desk={desk} live={live} />
            </div>
          </div>
        </div>

        <SpxCommentaryRail desk={desk} live={live} />
      </div>
    </div>
  );
}
