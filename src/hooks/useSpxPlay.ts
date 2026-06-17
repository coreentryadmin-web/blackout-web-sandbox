"use client";

import useSWR from "swr";
import { fetchSpxPlay } from "@/lib/api";

const PLAY_MS = 2_000;

export function useSpxPlay(sessionActive = true) {
  const { data, isValidating, isLoading } = useSWR("spx-play", fetchSpxPlay, {
    refreshInterval: sessionActive ? PLAY_MS : 0,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: false,
    dedupingInterval: 1_500,
  });

  return { play: data, playLoading: isLoading, playRefreshing: isValidating && !isLoading };
}
