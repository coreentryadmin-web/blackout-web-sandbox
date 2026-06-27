"use client";

import { useEffect, useState } from "react";
import { createPositionEventSource } from "@/lib/api";

/** SSE-backed live position stream. Returns null until the first payload arrives. */
export function usePositionStream<T = Record<string, unknown>>(): {
  positions: T[] | null;
  sseConnected: boolean;
} {
  const [positions, setPositions] = useState<T[] | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

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
      currentConn = createPositionEventSource(
        (payload) => {
          setPositions(payload.positions as T[]);
        },
        {
          onOpen: () => {
            reconnectAttempts = 0;
            setSseConnected(true);
          },
          onClose: () => {
            setSseConnected(false);
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
  }, []);

  return { positions, sseConnected };
}
