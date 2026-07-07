"use client";

import useSWR from "swr";
import { fetchSpxPowerHour } from "@/lib/api";
import { isPowerHourWindow } from "@/features/spx/lib/spx-play-session-guards";

const PH_POLL_MS = 10_000;
const PH_OFF_POLL_MS = 60_000;

/** Poll faster during the 2:45–3:15 PM ET window; slower pre/post for honest state. */
export function powerHourPollIntervalMs(): number {
  if (isPowerHourWindow()) return PH_POLL_MS;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  // 2:00–4:00 PM ET — hold may still be open until force-exit
  if (mins >= 14 * 60 && mins < 16 * 60) return PH_OFF_POLL_MS;
  return 0;
}

export function useSpxPowerHour() {
  const interval = powerHourPollIntervalMs();
  const { data, isValidating, isLoading } = useSWR("spx-power-hour", fetchSpxPowerHour, {
    refreshInterval: interval,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    keepPreviousData: true,
    dedupingInterval: 5_000,
  });

  return {
    powerHour: data?.power_hour ?? null,
    powerHourLoading: isLoading && !data,
    powerHourRefreshing: isValidating && Boolean(data),
    powerHourWindowActive: isPowerHourWindow(),
  };
}
