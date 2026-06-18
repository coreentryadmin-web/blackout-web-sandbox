"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { ApiCallEvent } from "@/lib/api-telemetry";

function fmtRel(iso: string): string {
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}

function statusLabel(event: ApiCallEvent): string {
  if (event.ok) return "OK";
  if (event.rate_limited) return "429";
  if (event.status) return String(event.status);
  return "ERR";
}

export function AdminApiLiveFeed({
  initialErrors,
  activeRetries,
  selectedId,
  onSelect,
}: {
  initialErrors: ApiCallEvent[];
  activeRetries: { correlation_id: string; endpoint: string; provider: string; attempt: number; max_attempts: number; next_retry_at: string | null; last_error: string | null }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [errors, setErrors] = useState<ApiCallEvent[]>(initialErrors);
  const [liveRetries, setLiveRetries] = useState(activeRetries);
  const [connected, setConnected] = useState(false);
  const seen = useRef(new Set(initialErrors.map((e) => e.id)));

  useEffect(() => {
    setErrors(initialErrors);
    initialErrors.forEach((e) => seen.current.add(e.id));
  }, [initialErrors]);

  useEffect(() => {
    setLiveRetries(activeRetries);
  }, [activeRetries]);

  useEffect(() => {
    const es = new EventSource("/api/admin/apis/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as {
          type: string;
          event?: ApiCallEvent;
          active_retries?: typeof liveRetries;
          recent_errors?: ApiCallEvent[];
        };

        if (data.type === "event" && data.event) {
          const ev = data.event;
          if (!ev.ok && !seen.current.has(ev.id)) {
            seen.current.add(ev.id);
            setErrors((prev) => [ev, ...prev].slice(0, 40));
          }
        }
        if (data.active_retries) {
          setLiveRetries(data.active_retries);
        }
      } catch {
        /* ignore */
      }
    };

    return () => es.close();
  }, []);

  return (
    <aside className="admin-cmd-feed">
      <div className="admin-cmd-feed-head">
        <div>
          <p className="admin-cmd-feed-kicker">Live incidents</p>
          <h3 className="admin-cmd-feed-title">Failed calls</h3>
        </div>
        <span className={clsx("admin-cmd-stream-pill", connected && "admin-cmd-stream-pill-live")}>
          <span className="admin-cmd-stream-dot" />
          {connected ? "SSE live" : "Reconnecting…"}
        </span>
      </div>

      {liveRetries.length > 0 && (
        <div className="admin-cmd-retry-banner">
          <p className="admin-cmd-retry-title">Active retries</p>
          {liveRetries.map((r) => (
            <div key={r.correlation_id} className="admin-cmd-retry-row">
              <span className="admin-cmd-retry-spin" aria-hidden />
              <span className="admin-cmd-retry-provider">{r.provider}</span>
              <code className="admin-api-mono">{r.endpoint}</code>
              <span className="admin-cmd-retry-meta">
                {r.attempt}/{r.max_attempts}
                {r.next_retry_at && ` · next ${fmtRel(r.next_retry_at)}`}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="admin-cmd-feed-list">
        <AnimatePresence initial={false}>
          {errors.length === 0 ? (
            <p className="admin-api-muted admin-cmd-feed-empty">No failures in window — all clear.</p>
          ) : (
            errors.map((ev) => (
              <motion.button
                key={ev.id}
                type="button"
                layout
                initial={{ opacity: 0, x: -12, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
                className={clsx("admin-cmd-incident", selectedId === ev.id && "admin-cmd-incident-active")}
                onClick={() => onSelect(ev.id)}
              >
                <div className="admin-cmd-incident-top">
                  <span className={clsx("admin-cmd-status", ev.rate_limited && "admin-cmd-status-warn")}>
                    {statusLabel(ev)}
                  </span>
                  <span className="admin-cmd-incident-provider">{ev.provider}</span>
                  <span className="admin-cmd-incident-time">{fmtRel(ev.at)}</span>
                </div>
                <code className="admin-cmd-incident-path">{ev.endpoint}</code>
                <p className="admin-cmd-incident-error">{ev.error ?? "Request failed"}</p>
                {ev.retry_status !== "none" && (
                  <span className="admin-cmd-incident-retry">
                    Retry {ev.retry_status} · attempt {ev.attempt}/{ev.max_attempts}
                  </span>
                )}
              </motion.button>
            ))
          )}
        </AnimatePresence>
      </div>
    </aside>
  );
}
