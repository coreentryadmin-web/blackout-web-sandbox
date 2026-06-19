"use client";

import { useEffect, useMemo } from "react";
import useSWR from "swr";
import { fetchSpxPlay } from "@/lib/api";
import type { SpxPlayPayload } from "@/lib/spx-play-engine";
import {
  clearSessionCacheKey,
  readSessionCache,
  todayEtYmdClient,
  writeSessionCache,
} from "@/lib/session-cache";
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
    const sameDirection =
      fresh.direction != null &&
      cached.direction != null &&
      fresh.direction === cached.direction;
    if (!sameDirection) return fresh;

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
        play_idea: fresh.gates.play_idea ?? cached.gates.play_idea,
      },
    };
  }

  return fresh;
}

export function clearPlayCache(): void {
  clearSessionCacheKey(PLAY_CACHE_KEY);
}

export function useSpxPlay(sessionActive = true) {
  const sessionDate = todayEtYmdClient();

  useEffect(() => {
    if (!sessionActive) clearPlayCache();
  }, [sessionActive]);

  const { data, isValidating, isLoading } = useSWR(
    sessionActive ? `spx-play:${sessionDate}` : null,
    fetchSpxPlay,
    {
      refreshInterval: sessionActive ? PLAY_MS : 0,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      keepPreviousData: false,
      dedupingInterval: 1_500,
      fallbackData: sessionActive
        ? readSessionCache<SpxPlayPayload>(PLAY_CACHE_KEY, PLAY_CACHE_MAX_AGE_MS)
        : undefined,
      onSuccess: (payload) => {
        if (!sessionActive || !payload || !shouldPersistPlayPayload(payload)) return;
        writeSessionCache(PLAY_CACHE_KEY, payload, sessionDate);
      },
    }
  );

  const play = useMemo(() => {
    if (!sessionActive) return null;
    const stored = readSessionCache<SpxPlayPayload>(PLAY_CACHE_KEY, PLAY_CACHE_MAX_AGE_MS);
    return mergePlayWithCache(data, stored ?? undefined);
  }, [data, sessionActive]);

  return {
    play,
    playLoading: sessionActive && isLoading && !play,
    playRefreshing: sessionActive && isValidating && Boolean(play),
  };
}
