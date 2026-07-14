"use client";

// Client half of the 0DTE live-marks lane (B-9): consumes the ~1s SSE push from
// /api/market/zerodte/marks/stream, with a REST poll fallback (2.5s) that only
// runs while the stream is down. The hook exposes the marks keyed by ticker plus
// a 1s clock so renderers can apply the stale-honesty rule (dim any number whose
// mark_as_of is older than ZERODTE_MARK_STALE_MS) instead of presenting an old
// premium as live. The hook never computes P&L — live_pnl_pct arrives computed
// server-side in ONE place against the pinned ledger entry (live-marks.ts).

import { useEffect, useRef, useState } from "react";
import type { ZeroDteLiveMarkRow, ZeroDteLiveMarksPayload } from "@/lib/zerodte/live-marks";

const STREAM_URL = "/api/market/zerodte/marks/stream";
const POLL_URL = "/api/market/zerodte/marks";
const POLL_MS = 2_500;
/** No SSE frame for this long → the poll fallback wakes up (heartbeats don't count
 *  as frames, so this is deliberately > one 1s tick but < the 15s heartbeat). */
const SSE_QUIET_MS = 4_000;

export type ZeroDteLiveMarksState = {
  /** Latest mark row per ticker (open plays only — the bounded active set). */
  byTicker: Map<string, ZeroDteLiveMarkRow>;
  /** 1s-ticking clock for staleness math against each row's mark_as_of. */
  nowMs: number;
  /** Which transport delivered the latest payload — honesty/debug, not logic. */
  transport: "sse" | "poll" | null;
};

export function useZeroDteLiveMarks(enabled: boolean): ZeroDteLiveMarksState {
  const [byTicker, setByTicker] = useState<Map<string, ZeroDteLiveMarkRow>>(new Map());
  const [transport, setTransport] = useState<"sse" | "poll" | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const lastSseAtRef = useRef(0);

  // 1s clock — drives staleness dimming even when no new frames arrive.
  useEffect(() => {
    if (!enabled) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let closed = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryMs = 1_000;
    let pollInflight = false;

    const applyPayload = (payload: ZeroDteLiveMarksPayload, via: "sse" | "poll") => {
      if (closed || !payload || !Array.isArray(payload.marks)) return;
      setByTicker(new Map(payload.marks.map((m) => [m.ticker, m])));
      setTransport(via);
    };

    const connect = () => {
      if (closed) return;
      es?.close();
      es = new EventSource(STREAM_URL);
      es.onopen = () => {
        retryMs = 1_000;
        lastSseAtRef.current = Date.now();
      };
      es.onmessage = (e) => {
        lastSseAtRef.current = Date.now();
        try {
          applyPayload(JSON.parse(e.data) as ZeroDteLiveMarksPayload, "sse");
        } catch {
          /* malformed frame — the next tick replaces it */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryMs = Math.min(retryMs * 2, 30_000);
          connect();
        }, retryMs);
      };
    };

    connect();

    // REST fallback: fires only while the stream has been quiet — covers proxies
    // that break SSE and the reconnect backoff window, then goes dormant again.
    const pollTimer = setInterval(() => {
      if (closed || pollInflight) return;
      if (Date.now() - lastSseAtRef.current < SSE_QUIET_MS) return;
      pollInflight = true;
      fetch(POLL_URL, { cache: "no-store", credentials: "same-origin" })
        .then((r) => (r.ok ? (r.json() as Promise<ZeroDteLiveMarksPayload>) : null))
        .then((payload) => {
          if (payload) applyPayload(payload, "poll");
        })
        .catch(() => {})
        .finally(() => {
          pollInflight = false;
        });
    }, POLL_MS);

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(pollTimer);
      es?.close();
      es = null;
    };
  }, [enabled]);

  return { byTicker, nowMs, transport };
}
