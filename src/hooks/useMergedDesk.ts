"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetchSpxDesk, fetchSpxDeskPulse } from "@/lib/api";
import { mergePulseIntoDesk, type SpxDeskPayload } from "@/lib/providers/spx-desk";

const PULSE_MS = 2_000;
const FULL_DESK_MS = 8_000;

const swrLiveOpts = {
  refreshWhenHidden: true,
  refreshWhenOffline: false,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 0,
  compare: () => false as const,
};

export function useMergedDesk() {
  const {
    data: desk,
    isLoading: deskLoading,
    isValidating: deskValidating,
  } = useSWR("spx-desk-full", fetchSpxDesk, {
    ...swrLiveOpts,
    refreshInterval: FULL_DESK_MS,
    focusThrottleInterval: FULL_DESK_MS,
  });

  const {
    data: pulse,
    isValidating: pulseValidating,
  } = useSWR("spx-desk-pulse", fetchSpxDeskPulse, {
    ...swrLiveOpts,
    refreshInterval: PULSE_MS,
    focusThrottleInterval: PULSE_MS,
  });

  const merged = useMemo((): SpxDeskPayload | undefined => {
    if (!desk) return undefined;
    if (!pulse?.available) return desk;
    return mergePulseIntoDesk(desk, pulse);
  }, [desk, pulse]);

  const live = Boolean(merged?.available && (merged?.price ?? 0) > 0);
  const refreshing = (deskValidating && !deskLoading) || pulseValidating;

  return { desk: merged, live, refreshing, deskLoading };
}
