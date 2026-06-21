import { deskCacheTtlMs, deskFlowCacheTtlMs, deskPulseCacheTtlMs } from "@/lib/providers/config";
import {
  buildSpxDesk,
  buildSpxDeskFlow,
  buildSpxDeskPulse,
} from "@/lib/providers/spx-desk";
import type { SpxDeskFlow, SpxDeskPayload, SpxDeskPulse } from "@/lib/providers/spx-desk";
import { mergeDeskLayers } from "@/lib/spx-desk-merge";
import { withServerCache } from "@/lib/server-cache";
import { todayEtYmd } from "@/lib/providers/spx-session";

export type MergedSpxDeskBundle = {
  desk: SpxDeskPayload;
  flow: SpxDeskFlow | null;
  pulse: SpxDeskPulse | null;
  merged: SpxDeskPayload;
};

/** Single server path: cache lanes → merge pulse + flow into desk. */
export async function loadMergedSpxDesk(): Promise<MergedSpxDeskBundle> {
  // ISSUE-25: Include session date in cache keys so a process running across midnight
  // serves fresh data on the new session rather than stale prior-day data.
  const date = todayEtYmd();
  const [desk, flow, pulse] = await Promise.all([
    withServerCache(`spx-desk:${date}`, deskCacheTtlMs(), buildSpxDesk, {
      staleWhileRevalidate: false,
    }),
    withServerCache(`spx-desk-flow:${date}`, deskFlowCacheTtlMs(), buildSpxDeskFlow, {
      staleWhileRevalidate: false,
    }),
    withServerCache(`spx-desk-pulse:${date}`, deskPulseCacheTtlMs(), buildSpxDeskPulse, {
      staleWhileRevalidate: false,
    }),
  ]);

  const merged = mergeDeskLayers(desk, flow, pulse);
  return { desk, flow, pulse, merged };
}
