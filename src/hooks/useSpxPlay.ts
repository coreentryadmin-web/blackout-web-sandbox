"use client";

import useSWR from "swr";
import { fetchSpxPlay } from "@/lib/api";
import type { SpxPlayPayload } from "@/lib/spx-play-engine";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";

const PLAY_MS = 3_000;
const PLAY_CACHE_KEY = "spx-play";
const PLAY_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function useSpxPlay(sessionActive = true) {
  const cached = readSessionCache<SpxPlayPayload>(PLAY_CACHE_KEY, PLAY_CACHE_MAX_AGE_MS);

  const { data, isValidating, isLoading } = useSWR("spx-play", fetchSpxPlay, {
    refreshInterval: sessionActive ? PLAY_MS : 0,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    keepPreviousData: true,
    dedupingInterval: 1_500,
    fallbackData: cached,
    onSuccess: (payload) => {
      if (payload) writeSessionCache(PLAY_CACHE_KEY, payload);
    },
  });

  const play = data ?? cached;

  return {
    play,
    playLoading: isLoading && !play,
    playRefreshing: isValidating && Boolean(play),
  };
}
