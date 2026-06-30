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
  // SWR: return last good snapshot immediately while the background refresh runs.
  // Prevents a cold Massive chain fetch (20s+) from blocking play/desk polling.
  const [desk, flow, pulse] = await Promise.all([
    withServerCache(`spx-desk:${date}`, deskCacheTtlMs(), buildSpxDesk),
    withServerCache(`spx-desk-flow:${date}`, deskFlowCacheTtlMs(), buildSpxDeskFlow),
    withServerCache(`spx-desk-pulse:${date}`, deskPulseCacheTtlMs(), buildSpxDeskPulse),
  ]);

  const merged = mergeDeskLayers(desk, flow, pulse);
  return { desk, flow, pulse, merged };
}
