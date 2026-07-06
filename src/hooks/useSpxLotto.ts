"use client";

import useSWR from "swr";
import { useEffect } from "react";
import { fetchSpxLottoToday } from "@/lib/api";
import { isLottoPollWindow } from "@/lib/spx-play-session-guards";

const LOTTO_PREMARKET_MS = 60_000;
const LOTTO_OPEN_MS = 10_000;

/** Poll interval during the lotto poll window; 0 outside it (still fetches once on mount). */
export function lottoPollIntervalMs(): number {
  if (!isLottoPollWindow()) return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  return mins < 9 * 60 + 30 ? LOTTO_PREMARKET_MS : LOTTO_OPEN_MS;
}

/** Lotto track polls independently of main desk session — 7:00 AM–2:00 PM ET (engine intraday cutoff). */
export function useSpxLotto() {
  const interval = lottoPollIntervalMs();
  const { data, isValidating, isLoading, mutate } = useSWR("spx-lotto-today", fetchSpxLottoToday, {
    refreshInterval: interval,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    // H-2: revalidateOnFocus so a tab focus after 10:30 refreshes the final expired state
    // rather than showing stale data indefinitely (interval=0 after window closes).
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    keepPreviousData: true,
    dedupingInterval: 5_000,
  });

  // H-1: Schedule an immediate mutate() at 9:30 ET cash open so the interval dynamically
  // switches from 60s (premarket) to 10s (open) without waiting for the next render cycle.
  useEffect(() => {
    const now = new Date();
    const nyParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).formatToParts(now);
    const h = Number(nyParts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(nyParts.find((p) => p.type === "minute")?.value ?? 0);
    const s = Number(nyParts.find((p) => p.type === "second")?.value ?? 0);
    const etSecondsNow = h * 3600 + m * 60 + s;
    const cashOpenSeconds = 9 * 3600 + 30 * 60;
    const msUntilOpen = (cashOpenSeconds - etSecondsNow) * 1000;
    if (msUntilOpen <= 0) return; // already past cash open
    const timer = setTimeout(() => {
      void mutate();
    }, msUntilOpen);
    return () => clearTimeout(timer);
  }, [mutate]);

  return {
    lotto: data?.lotto ?? null,
    lottoHistory: data?.history ?? [],
    lottoLoading: isLoading && !data,
    lottoRefreshing: isValidating && Boolean(data),
    lottoWindowActive: isLottoPollWindow(),
  };
}
