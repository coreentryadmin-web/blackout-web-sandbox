"use client";

import useSWR from "swr";
import type { PlayOutcomeStats } from "@/features/spx/lib/spx-play-outcomes";

type OutcomesResponse = {
  stats: PlayOutcomeStats | null;
  adaptive: unknown;
  rows: unknown[];
  error?: string;
};

/**
 * Surfaces the EXISTING lifetime play-outcome stats (overall win rate, closed
 * count, days of data, cold-BUY vs WATCH-promote splits) to premium users.
 *
 * No computation here: it reads `data.stats` straight from the already-premium
 * GET /api/market/spx/outcomes endpoint (authorizeMarketDeskApi -> premium).
 * The companion useSpxDayPerformance hook hits the same URL for TODAY-only
 * numbers; SWR dedupes the two subscribers into a single network request.
 */
export function useSpxTrackRecord() {
  const { data, error, isLoading } = useSWR<OutcomesResponse>(
    "/api/market/spx/outcomes",
    (url: string) =>
      fetch(url, { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()),
    { refreshInterval: 60_000, revalidateOnFocus: false }
  );

  return {
    stats: data?.stats ?? null,
    loading: isLoading,
    error: !!error || !!data?.error,
  };
}
