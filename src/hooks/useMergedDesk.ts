"use client";

import { useMemo, useRef } from "react";
import useSWR from "swr";
import { fetchSpxDesk, fetchSpxDeskFlow, fetchSpxDeskPulse } from "@/lib/api";
import { mergeDeskLayers, mergePulseIntoDesk } from "@/lib/spx-desk-merge";
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


function isDeskSessionLive(pulse?: {
  market_open?: boolean;
  market_label?: string;
  market_status?: string;
}): boolean {
  if (!pulse) return true;
  return (
    pulse.market_open === true ||
    pulse.market_label === "PRE-MARKET" ||
    pulse.market_status === "premarket"
  );
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
      refreshInterval: (latest) => (isDeskSessionLive(latest) ? PULSE_MS : 0),
      dedupingInterval: 800,
      focusThrottleInterval: PULSE_MS,
    }
  );

  const sessionActive = isDeskSessionLive(pulse) || isDeskSessionLive(deskStable.current);

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
