import { useEffect, useRef, useCallback } from "react";
import type { MatrixDelta } from "@/lib/gex-matrix-delta";

/**
 * Subscribes to real-time GEX matrix delta updates via SSE and applies them to local state.
 *
 * Usage:
 *   useGexMatrixDeltas(ticker, (delta) => {
 *     setData(prev => applyDelta(prev, delta));
 *   });
 *
 * The callback receives each delta event after the initial snapshot is received.
 * Returns a cleanup function that closes the connection on unmount.
 */
export function useGexMatrixDeltas(
  ticker: string | undefined,
  onDelta: (delta: MatrixDelta) => void
) {
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!ticker) return;

    try {
      const url = `/api/market/gex-matrix-deltas?ticker=${encodeURIComponent(ticker)}`;
      const eventSource = new EventSource(url);

      eventSource.addEventListener("message", (event) => {
        try {
          const delta = JSON.parse(event.data) as MatrixDelta;
          onDelta(delta);
        } catch (err) {
          console.warn("[useGexMatrixDeltas] Failed to parse delta:", err);
        }
      });

      eventSource.addEventListener("error", (event) => {
        console.warn("[useGexMatrixDeltas] Connection error", event);
        eventSource.close();
        eventSourceRef.current = null;
        // Could implement reconnection logic here if needed
      });

      eventSourceRef.current = eventSource;
    } catch (err) {
      console.warn("[useGexMatrixDeltas] Failed to create EventSource:", err);
    }
  }, [ticker, onDelta]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);
}

/**
 * Helper to apply a delta to a matrix.
 *
 * For now this is a no-op stub — the client would need to:
 * 1. Find each strike in the current matrix by value
 * 2. Update the gex/vex cells for that strike across expiries
 * 3. Recompute strike totals
 * 4. Recompute walls/flip if needed
 *
 * This is complex because the matrix structure uses expiry columns and strike rows,
 * and updating a single cell requires understanding the multi-dimensional structure.
 * For MVP, clients can ignore SSE deltas and rely on the 20s SWR refresh until
 * a full delta-merge implementation is needed.
 */
export function applyDeltaToMatrix(
  matrix: any,
  delta: MatrixDelta
): any {
  // Stub: full implementation requires understanding matrix cell structure
  // For now, the delta is broadcast but clients continue to use SWR polls
  return matrix;
}
