"use client";

import { useMemo, useRef } from "react";
import useSWR from "swr";
import { fetchSpxDesk, fetchSpxDeskFlow, fetchSpxDeskPulse } from "@/lib/api";
import { mergeFlowIntoDesk, mergePulseIntoDesk } from "@/lib/spx-desk-merge";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";

const PULSE_MS = 1_000;
const FLOW_MS = 2_000;
const FULL_DESK_MS = 15_000;
const DESK_CACHE_KEY = "spx-merged-desk";
/** Keep cached desk for the trading day across refresh/navigation. */
const DESK_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const swrLiveOpts = {
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  keepPreviousData: true,
};

function mergeDeskLayers(
  desk: SpxDeskPayload,
  flow: Awaited<ReturnType<typeof fetchSpxDeskFlow>> | undefined,
  pulse: Awaited<ReturnType<typeof fetchSpxDeskPulse>> | undefined
): SpxDeskPayload {
  let out = desk;
  if (flow?.available) out = mergeFlowIntoDesk(out, flow);
  if (pulse) {
    if (pulse.available) out = mergePulseIntoDesk(out, pulse);
    else {
      out = {
        ...out,
        market_open: pulse.market_open,
        market_status: pulse.market_status,
        market_label: pulse.market_label,
        polled_at: pulse.polled_at,
      };
    }
  }
  return out;
}

export function useMergedDesk() {
  const deskStable = useRef<SpxDeskPayload | undefined>(
    readSessionCache<SpxDeskPayload>(DESK_CACHE_KEY, DESK_CACHE_MAX_AGE_MS)
  );

  const { data: pulse, isValidating: pulseValidating } = useSWR(
    "spx-desk-pulse",
    fetchSpxDeskPulse,
    {
      ...swrLiveOpts,
      refreshInterval: (latest) => (latest?.market_open === false ? 0 : PULSE_MS),
      dedupingInterval: 800,
      focusThrottleInterval: PULSE_MS,
    }
  );

  const sessionActive =
    pulse?.market_open ?? deskStable.current?.market_open ?? true;

  const {
    data: desk,
    isLoading: deskLoading,
    isValidating: deskValidating,
  } = useSWR("spx-desk-full", fetchSpxDesk, {
    ...swrLiveOpts,
    refreshInterval: sessionActive ? FULL_DESK_MS : 0,
    dedupingInterval: FULL_DESK_MS - 500,
    focusThrottleInterval: FULL_DESK_MS,
  });

  const { data: flow, isValidating: flowValidating } = useSWR(
    "spx-desk-flow",
    fetchSpxDeskFlow,
    {
      ...swrLiveOpts,
      refreshInterval: sessionActive ? FLOW_MS : 0,
      dedupingInterval: 1_500,
      focusThrottleInterval: FLOW_MS,
    }
  );

  const merged = useMemo((): SpxDeskPayload | undefined => {
    let out: SpxDeskPayload | undefined;

    if (desk) {
      try {
        out = mergeDeskLayers(desk, flow, pulse);
      } catch {
        out = desk;
      }
    } else if (deskStable.current) {
      out = deskStable.current;
      if (pulse?.available) {
        try {
          out = mergePulseIntoDesk(out, pulse);
        } catch {
          // keep cached desk
        }
      } else if (pulse) {
        out = {
          ...out,
          market_open: pulse.market_open,
          market_status: pulse.market_status,
          market_label: pulse.market_label,
          polled_at: pulse.polled_at,
        };
      }
    }

    if (out) {
      deskStable.current = out;
      writeSessionCache(DESK_CACHE_KEY, out);
    }

    return out;
  }, [desk, flow, pulse]);

  const live = Boolean(
    sessionActive &&
      merged?.market_open !== false &&
      merged?.available &&
      (merged?.price ?? 0) > 0
  );

  const refreshing =
    sessionActive &&
    Boolean(merged) &&
    ((deskValidating && Boolean(desk)) || flowValidating || pulseValidating);

  const initialLoading = deskLoading && !merged;

  return {
    desk: merged,
    live,
    refreshing,
    deskLoading: initialLoading,
    sessionActive,
    marketLabel: pulse?.market_label ?? merged?.market_label,
  };
}
