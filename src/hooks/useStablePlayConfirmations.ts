"use client";

import { useEffect, useRef } from "react";
import type { SpxPlayPayload } from "@/lib/spx-play-engine";
import { readSessionCache, writeSessionCache, clearSessionCacheKey } from "@/lib/session-cache";

const LAYER_CACHE_KEY = "spx-play-confirmation-layer";
const LAYER_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type PlayConfirmationLayer = {
  confirmations: NonNullable<SpxPlayPayload["confirmations"]>;
  technicals: SpxPlayPayload["technicals"];
  gates: Pick<SpxPlayPayload["gates"], "blocks" | "warnings" | "play_idea">;
  watch: SpxPlayPayload["watch"];
  telemetry: SpxPlayPayload["telemetry"];
  as_of: string;
};

function layerFromPlay(play: SpxPlayPayload): PlayConfirmationLayer | null {
  if (!play.confirmations?.checks?.length) return null;
  return {
    confirmations: play.confirmations,
    technicals: play.technicals,
    gates: {
      blocks: play.gates.blocks,
      warnings: play.gates.warnings,
      play_idea: play.gates.play_idea,
    },
    watch: play.watch,
    telemetry: play.telemetry,
    as_of: play.as_of,
  };
}

function loadLayer(): PlayConfirmationLayer | null {
  return readSessionCache<PlayConfirmationLayer>(LAYER_CACHE_KEY, LAYER_CACHE_MAX_AGE_MS) ?? null;
}

/** Last non-empty confirmation layer — survives refresh/navigation and merges live updates. */
export function useStablePlayConfirmations(play: SpxPlayPayload | null | undefined) {
  const stableRef = useRef<PlayConfirmationLayer | null>(loadLayer());

  useEffect(() => {
    if (!play) return;
    const next = layerFromPlay(play);
    if (next) {
      stableRef.current = next;
      writeSessionCache(LAYER_CACHE_KEY, next);
      return;
    }
    // Play reset to SCANNING without confirmations — drop stale WATCH/BUY checks.
    if (play.action === "SCANNING") {
      stableRef.current = null;
      clearSessionCacheKey(LAYER_CACHE_KEY);
    }
  }, [play]);

  const live = play ? layerFromPlay(play) : null;
  if (live) return live;
  if (play?.action === "SCANNING") return null;
  return stableRef.current;
}

export function shouldPersistPlayPayload(payload: SpxPlayPayload): boolean {
  if (payload.confirmations?.checks?.length) return true;
  if (payload.action === "BUY" || payload.action === "HOLD" || payload.action === "TRIM") return true;
  if (payload.action === "WATCHING") return true;
  if (payload.available && payload.action === "SCANNING" && payload.factors.length > 0) return true;
  return false;
}
