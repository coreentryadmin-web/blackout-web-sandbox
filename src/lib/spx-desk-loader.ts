import { deskCacheTtlMs, deskFlowCacheTtlMs, deskPulseCacheTtlMs } from "@/lib/providers/config";
import {
  buildSpxDesk,
  buildSpxDeskFlow,
  buildSpxDeskPulse,
} from "@/lib/providers/spx-desk";
import type { SpxDeskFlow, SpxDeskPayload, SpxDeskPulse } from "@/lib/providers/spx-desk";
import { mergeDeskLayers } from "@/lib/spx-desk-merge";
import { withServerCache } from "@/lib/server-cache";

export type MergedSpxDeskBundle = {
  desk: SpxDeskPayload;
  flow: SpxDeskFlow | null;
  pulse: SpxDeskPulse | null;
  merged: SpxDeskPayload;
};

/** Single server path: cache lanes → merge pulse + flow into desk. */
export async function loadMergedSpxDesk(): Promise<MergedSpxDeskBundle> {
  const [desk, flow, pulse] = await Promise.all([
    withServerCache("spx-desk", deskCacheTtlMs(), buildSpxDesk, {
      staleWhileRevalidate: false,
    }),
    withServerCache("spx-desk-flow", deskFlowCacheTtlMs(), buildSpxDeskFlow, {
      staleWhileRevalidate: false,
    }),
    withServerCache("spx-desk-pulse", deskPulseCacheTtlMs(), buildSpxDeskPulse, {
      staleWhileRevalidate: false,
    }),
  ]);

  const merged = mergeDeskLayers(desk, flow, pulse);
  return { desk, flow, pulse, merged };
}
