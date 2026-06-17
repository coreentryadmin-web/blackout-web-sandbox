"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetchSpxDesk, fetchSpxDeskFlow, fetchSpxDeskPulse } from "@/lib/api";
import { mergeFlowIntoDesk, mergePulseIntoDesk } from "@/lib/spx-desk-merge";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

const PULSE_MS = 2_000;
const FLOW_MS = 4_000;
const FULL_DESK_MS = 15_000;

const swrLiveOpts = {
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
};

export function useMergedDesk() {
  const {
    data: desk,
    isLoading: deskLoading,
    isValidating: deskValidating,
  } = useSWR("spx-desk-full", fetchSpxDesk, {
    ...swrLiveOpts,
    refreshInterval: FULL_DESK_MS,
    dedupingInterval: FULL_DESK_MS - 500,
    focusThrottleInterval: FULL_DESK_MS,
  });

  const { data: flow, isValidating: flowValidating } = useSWR(
    "spx-desk-flow",
    fetchSpxDeskFlow,
    {
      ...swrLiveOpts,
      refreshInterval: FLOW_MS,
      dedupingInterval: FLOW_MS - 500,
      focusThrottleInterval: FLOW_MS,
    }
  );

  const { data: pulse, isValidating: pulseValidating } = useSWR(
    "spx-desk-pulse",
    fetchSpxDeskPulse,
    {
      ...swrLiveOpts,
      refreshInterval: PULSE_MS,
      dedupingInterval: PULSE_MS - 500,
      focusThrottleInterval: PULSE_MS,
    }
  );

  const merged = useMemo((): SpxDeskPayload | undefined => {
    if (!desk) return undefined;
    try {
      let out = desk;
      if (flow?.available) out = mergeFlowIntoDesk(out, flow);
      if (pulse?.available) out = mergePulseIntoDesk(out, pulse);
      return out;
    } catch {
      return desk;
    }
  }, [desk, flow, pulse]);

  const live = Boolean(merged?.available && (merged?.price ?? 0) > 0);
  const refreshing = (deskValidating && !deskLoading) || flowValidating || pulseValidating;

  return { desk: merged, live, refreshing, deskLoading };
}
