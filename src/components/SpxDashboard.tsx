"use client";

import useSWR from "swr";
import { fetchSpxDesk } from "@/lib/api";
import { SpxSniperHeader } from "@/components/desk/SpxSniperHeader";
import { SpxCommentaryRail } from "@/components/desk/SpxCommentaryRail";
import { SpxChart } from "@/components/desk/SpxChart";
import {
  SpxDarkPoolCard,
  SpxGexLadder,
  SpxIntelStrip,
  SpxIvTermBars,
  SpxNetPremSpark,
  SpxOiChangeStrip,
  SpxUnifiedTape,
} from "@/components/desk/SpxDeskPanels";

const DESK_REFRESH_MS = 3_000;

export function SpxDashboard() {
  const { data: desk, isLoading, isValidating } = useSWR(
    "spx-desk-live",
    fetchSpxDesk,
    {
      refreshInterval: DESK_REFRESH_MS,
      refreshWhenHidden: true,
      refreshWhenOffline: false,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 0,
      focusThrottleInterval: DESK_REFRESH_MS,
      // Always re-render when a poll completes — default deep-compare skips updates.
      compare: () => false,
    }
  );

  const live = Boolean(desk?.available && (desk?.price ?? 0) > 0);
  const deskRefreshing = isValidating && !isLoading;

  return (    <div className="spx-sniper-desk">
      <SpxSniperHeader desk={desk} live={live} />

      <SpxIntelStrip desk={desk} live={live} />

      <div className="spx-sniper-triple">
        <aside className="spx-sniper-left-rail spx-left-stack">
          <SpxDarkPoolCard desk={desk} live={live} />
          <SpxGexLadder desk={desk} live={live} refreshing={deskRefreshing} />
          <SpxUnifiedTape desk={desk} live={live} refreshing={deskRefreshing} />
        </aside>

        <div className="spx-sniper-chart-col spx-center-stack">
          <SpxChart fill />
          <div className="spx-center-panels">
            <div className="spx-center-panels-row">
              <SpxNetPremSpark desk={desk} live={live} />
              <SpxIvTermBars desk={desk} live={live} />
            </div>
            <SpxOiChangeStrip desk={desk} live={live} />
          </div>
        </div>

        <SpxCommentaryRail desk={desk} live={live} />
      </div>
    </div>
  );
}
