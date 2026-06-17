"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetchSpxPlay } from "@/lib/api";
import type { SpxPlayPayload } from "@/lib/spx-play-engine";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { shouldPersistPlayPayload } from "@/hooks/useStablePlayConfirmations";

const PLAY_MS = 3_000;
const PLAY_CACHE_KEY = "spx-play";
const PLAY_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function mergePlayWithCache(
  fresh: SpxPlayPayload | undefined,
  cached: SpxPlayPayload | undefined
): SpxPlayPayload | null {
  if (!fresh && !cached) return null;
  if (!fresh) return cached ?? null;
  if (!cached) return fresh;

  const freshHasLayer = Boolean(fresh.confirmations?.checks?.length);
  const cachedHasLayer = Boolean(cached.confirmations?.checks?.length);

  if (!freshHasLayer && cachedHasLayer) {
    return {
      ...fresh,
      confirmations: cached.confirmations,
      technicals: fresh.technicals ?? cached.technicals,
      mtf: fresh.mtf ?? cached.mtf,
      watch: fresh.watch ?? cached.watch,
      telemetry: fresh.telemetry ?? cached.telemetry,
      gates: {
        ...fresh.gates,
        blocks: fresh.gates.blocks.length ? fresh.gates.blocks : cached.gates.blocks,
        warnings: fresh.gates.warnings.length ? fresh.gates.warnings : cached.gates.warnings,
      },
    };
  }

  return fresh;
}

export function useSpxPlay(sessionActive = true) {
  const { data, isValidating, isLoading } = useSWR("spx-play", fetchSpxPlay, {
    refreshInterval: sessionActive ? PLAY_MS : 0,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    keepPreviousData: true,
    dedupingInterval: 1_500,
    fallbackData: readSessionCache<SpxPlayPayload>(PLAY_CACHE_KEY, PLAY_CACHE_MAX_AGE_MS),
    onSuccess: (payload) => {
      if (!payload || !shouldPersistPlayPayload(payload)) return;
      writeSessionCache(PLAY_CACHE_KEY, payload);
    },
  });

  const play = useMemo(() => {
    const stored = readSessionCache<SpxPlayPayload>(PLAY_CACHE_KEY, PLAY_CACHE_MAX_AGE_MS);
    return mergePlayWithCache(data, stored ?? undefined);
  }, [data]);

  return {
    play,
    playLoading: isLoading && !play,
    playRefreshing: isValidating && Boolean(play),
  };
}
