"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetchSpxDesk, fetchSpxDeskFlow, fetchSpxDeskPulse } from "@/lib/api";
import { mergeDeskLayers, mergePulseIntoDesk, resetSpxDeskMergeCache } from "@/lib/spx-desk-merge";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { usePulseStream } from "@/hooks/usePulseStream";

const PULSE_REST_MS = 1_000;
const PULSE_REST_SSE_MS = 10_000;
const FLOW_MS = 2_000;
const FULL_DESK_MS = 10_000;
const DESK_CACHE_KEY = "spx-merged-desk";
/** Keep cached desk for the trading day across refresh/navigation. */
const DESK_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/**
 * Throttle the sessionStorage write of the merged desk. The desk re-merges on
 * every pulse tick (~1s); persisting that hot a stream to sessionStorage on each
 * change is wasteful (JSON.stringify of the full payload + a synchronous storage
 * write). 7.5s keeps a fresh-enough snapshot for refresh/navigation restore while
 * staying well under the pulse cadence. The latest value is always flushed on
 * visibilitychange/unmount, so throttling never loses the final state.
 */
const DESK_CACHE_WRITE_MS = 7_500;

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
  const sessionDateRef = useRef(todayEtYmd());
  const deskStable = useRef<SpxDeskPayload | undefined>(
    readSessionCache<SpxDeskPayload>(DESK_CACHE_KEY, DESK_CACHE_MAX_AGE_MS)
  );
  const [pulseSseConnected, setPulseSseConnected] = useState(false);
  // Initialized becomes true after the first pulse or REST response arrives.
  // Prevents sessionActive from returning true before any data is loaded.
  const [initialized, setInitialized] = useState(false);
  const onPulseConnection = useCallback((connected: boolean) => {
    setPulseSseConnected(connected);
  }, []);

  const { data: pulseRest, isValidating: pulseValidating } = useSWR(
    "spx-desk-pulse",
    fetchSpxDeskPulse,
    {
      ...swrLiveOpts,
      refreshInterval: (latest) => {
        if (!isDeskSessionLive(latest)) return 0;
        return pulseSseConnected ? PULSE_REST_SSE_MS : PULSE_REST_MS;
      },
      dedupingInterval: 800,
      focusThrottleInterval: PULSE_REST_MS,
    }
  );

  const { pulse, intervalFlow } = usePulseStream(pulseRest, onPulseConnection);

  // Midnight rollover: fires when pulse ticks AND every 60s as a safety net
  // (handles the case where pulse goes offline overnight).
  useEffect(() => {
    const today = todayEtYmd();
    if (sessionDateRef.current === today) return;
    sessionDateRef.current = today;
    resetSpxDeskMergeCache();
    deskStable.current = undefined;
  }, [pulse?.polled_at, pulseRest?.polled_at]);

  useEffect(() => {
    const id = setInterval(() => {
      const today = todayEtYmd();
      if (sessionDateRef.current !== today) {
        sessionDateRef.current = today;
        resetSpxDeskMergeCache();
        deskStable.current = undefined;
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Mark initialized after first data arrives so sessionActive is not
  // prematurely true during off-hours before any response lands.
  useEffect(() => {
    if (!initialized && (pulse != null || pulseRest != null)) {
      setInitialized(true);
    }
  }, [initialized, pulse, pulseRest]);

  const sessionActive =
    initialized
      ? isDeskSessionLive(pulse) || isDeskSessionLive(deskStable.current)
      : false;

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

  // PURE: derive the merged desk only. No ref mutation, no sessionStorage write
  // here — those are commit-phase side effects handled by the effect below.
  // Reading deskStable.current as the fallback base is safe: it holds the prior
  // committed value and the effect updates it only after this render commits.
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

    return out;
  }, [desk, flow, pulse]);

  // Side effects for the merged desk, in commit phase:
  //  1. deskStable.current is updated on EVERY change (unthrottled) — sessionActive
  //     and the merge fallback above read it, so it must stay current.
  //  2. The sessionStorage write is throttled to DESK_CACHE_WRITE_MS to avoid a
  //     storage write on every ~1s pulse tick.
  const lastDeskWriteRef = useRef(0);
  const pendingDeskRef = useRef<SpxDeskPayload | undefined>(undefined);
  useEffect(() => {
    if (!merged) return;
    deskStable.current = merged;
    pendingDeskRef.current = merged;
    const now = Date.now();
    if (now - lastDeskWriteRef.current >= DESK_CACHE_WRITE_MS) {
      lastDeskWriteRef.current = now;
      pendingDeskRef.current = undefined;
      writeSessionCache(DESK_CACHE_KEY, merged);
    }
  }, [merged]);

  // Flush the latest desk to sessionStorage on tab-hide and unmount so a
  // throttled-but-not-yet-written snapshot is never lost across navigation/refresh.
  useEffect(() => {
    const flush = () => {
      const pending = pendingDeskRef.current;
      if (!pending) return;
      pendingDeskRef.current = undefined;
      lastDeskWriteRef.current = Date.now();
      writeSessionCache(DESK_CACHE_KEY, pending);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);

  const live = Boolean(
    sessionActive &&
      merged?.available &&
      (merged?.price ?? 0) > 0 &&
      (merged?.market_open === true ||
        merged?.market_label === "PRE-MARKET" ||
        merged?.market_status === "premarket")
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
    intervalFlow,
  };
}
