"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPulseEventSource, type PulseStreamSnapshot } from "@/lib/api";
import type { SpxDeskPulse } from "@/lib/providers/spx-desk";
import { computeVixTermStructure } from "@/lib/vix-term-utils";

function indexPrice(snap?: { price: number } | null): number | null {
  const p = snap?.price;
  return p != null && p > 0 ? p : null;
}

function overlayFromStream(
  snap: PulseStreamSnapshot,
  base?: SpxDeskPulse | null
): Partial<SpxDeskPulse> {
  const price = indexPrice(snap.spx);
  if (price == null) return {};

  const vix = indexPrice(snap.vix);
  const vix9d = indexPrice(snap.vix9d);
  const vix3m = indexPrice(snap.vix3m);
  const tick = indexPrice(snap.tick);
  const trin = indexPrice(snap.trin);
  const add = indexPrice(snap.add);

  const vixTerm =
    vix != null
      ? computeVixTermStructure(vix, vix9d, vix3m)
      : base?.vix_term;

  return {
    available: true,
    polled_at: snap.t ? new Date(snap.t).toISOString() : new Date().toISOString(),
    price,
    spx_change_pct: snap.spx?.change_pct ?? base?.spx_change_pct ?? 0,
    vix: vix ?? base?.vix ?? null,
    vix_change_pct: snap.vix?.change_pct ?? base?.vix_change_pct ?? 0,
    tick: tick ?? base?.tick ?? null,
    trin: trin ?? base?.trin ?? null,
    add: add ?? base?.add ?? null,
    vix_term: vixTerm,
    above_vwap:
      base?.vwap != null && base.vwap > 0 ? price >= base.vwap : base?.above_vwap ?? false,
  };
}

/** Live Polygon index overlay via SSE — merges over REST pulse for structure fields. */
export function usePulseStream(
  basePulse?: SpxDeskPulse | null,
  onConnectionChange?: (connected: boolean) => void
): { pulse: SpxDeskPulse | undefined; sseConnected: boolean } {
  const [overlay, setOverlay] = useState<Partial<SpxDeskPulse> | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const baseRef = useRef(basePulse);
  baseRef.current = basePulse;

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    let currentConn: { close: () => void } | null | undefined = null;
    let unmounted = false;

    const scheduleReconnect = () => {
      if (unmounted) return;
      const delay = Math.min(2000 * Math.pow(2, reconnectAttempts), 30_000);
      reconnectAttempts++;
      reconnectTimeout = setTimeout(() => {
        if (!unmounted) connectSSE();
      }, delay);
    };

    const connectSSE = () => {
      currentConn = createPulseEventSource(
        (snap) => {
          setOverlay((prev) => ({
            ...prev,
            ...overlayFromStream(snap, baseRef.current ?? undefined),
          }));
        },
        {
          onOpen: () => {
            reconnectAttempts = 0;
            setSseConnected(true);
            onConnectionChange?.(true);
          },
          onClose: () => {
            setSseConnected(false);
            onConnectionChange?.(false);
            scheduleReconnect();
          },
        }
      );
    };

    connectSSE();

    return () => {
      unmounted = true;
      if (reconnectTimeout != null) clearTimeout(reconnectTimeout);
      currentConn?.close();
    };
  }, [onConnectionChange]);

  const pulse = useMemo((): SpxDeskPulse | undefined => {
    if (!basePulse && !overlay) return undefined;
    if (!basePulse) return overlay as SpxDeskPulse;
    if (!overlay) return basePulse;
    return { ...basePulse, ...overlay };
  }, [basePulse, overlay]);

  return { pulse, sseConnected };
}
