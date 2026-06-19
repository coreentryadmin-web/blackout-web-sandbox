"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { ApiCallEvent } from "@/lib/api-telemetry-types";
import { sanitizeTelemetryBody, sanitizeTelemetryUrl } from "@/lib/api-telemetry-sanitize";

type EventDetail = {
  event: ApiCallEvent;
  chain: ApiCallEvent[];
  endpoint_stats: {
    call_count: number;
    error_count: number;
    avg_latency_ms: number;
    p95_latency_ms?: number;
    p99_latency_ms?: number;
    last_at: string | null;
  } | null;
  active_retry: {
    attempt: number;
    max_attempts: number;
    next_retry_at: string | null;
    last_error: string | null;
  } | null;
  diagnosis: string[];
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AdminApiEventDetail({
  eventId,
  onClose,
}: {
  eventId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!eventId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    fetch(`/api/admin/apis/events/${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDetail(d))
      .finally(() => setLoading(false));
  }, [eventId]);

  return (
    <AnimatePresence>
      {eventId && (
        <>
          <motion.button
            type="button"
            className="admin-cmd-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-label="Close detail panel"
          />
          <motion.aside
            className="admin-cmd-drawer admin-cmd-vivid"
            initial={{ x: "100%", opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
          >
            <div className="admin-cmd-drawer-head">
              <div>
                <p className="admin-cmd-drawer-kicker">Incident deep dive</p>
                <h3 className="admin-cmd-drawer-title">API call forensics</h3>
              </div>
              <button type="button" className="admin-cmd-drawer-close" onClick={onClose}>
                ✕
              </button>
            </div>

            {loading && <p className="admin-api-muted p-4">Loading…</p>}

            {!loading && detail && (
              <div className="admin-cmd-drawer-body">
                <section className="admin-cmd-detail-section">
                  <div className="admin-cmd-detail-grid">
                    <DetailCell label="Provider" value={detail.event.provider} />
                    <DetailCell label="Method" value={detail.event.method} />
                    <DetailCell
                      label="HTTP status"
                      value={detail.event.status != null ? String(detail.event.status) : "—"}
                      tone={detail.event.ok ? "ok" : "error"}
                    />
                    <DetailCell label="Severity" value={detail.event.severity.toUpperCase()} tone={detail.event.ok ? "ok" : "error"} />
                    <DetailCell label="Latency" value={`${detail.event.latency_ms}ms`} />
                    <DetailCell label="Attempt" value={`${detail.event.attempt} / ${detail.event.max_attempts}`} />
                    <DetailCell label="Retry status" value={detail.event.retry_status} />
                    <DetailCell label="Phase" value={detail.event.phase} />
                    <DetailCell label="Rate limited" value={detail.event.rate_limited ? "Yes" : "No"} />
                  </div>
                </section>

                <section className="admin-cmd-detail-section">
                  <h4 className="admin-cmd-detail-heading">Endpoint</h4>
                  <code className="admin-cmd-detail-code">{detail.event.endpoint}</code>
                  <h4 className="admin-cmd-detail-heading">Request URL</h4>
                  <code className="admin-cmd-detail-code admin-cmd-detail-code-wrap">
                    {sanitizeTelemetryUrl(detail.event.request_url) ?? "—"}
                  </code>
                  {detail.event.request_body && (
                    <>
                      <h4 className="admin-cmd-detail-heading">Request body / query</h4>
                      <pre className="admin-cmd-detail-pre">
                        {sanitizeTelemetryBody(detail.event.request_body)}
                      </pre>
                    </>
                  )}
                </section>

                {detail.event.error && (
                  <section className="admin-cmd-detail-section admin-cmd-detail-error-box">
                    <h4 className="admin-cmd-detail-heading">Error</h4>
                    <pre className="admin-cmd-detail-pre">{detail.event.error}</pre>
                  </section>
                )}

                {detail.event.response_snippet && (
                  <section className="admin-cmd-detail-section">
                    <h4 className="admin-cmd-detail-heading">Response snippet</h4>
                    <pre className="admin-cmd-detail-pre">{detail.event.response_snippet}</pre>
                  </section>
                )}

                {detail.diagnosis.length > 0 && (
                  <section className="admin-cmd-detail-section">
                    <h4 className="admin-cmd-detail-heading">Diagnosis</h4>
                    <ul className="admin-cmd-diagnosis">
                      {detail.diagnosis.map((tip) => (
                        <li key={tip}>{tip}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {detail.active_retry && (
                  <section className="admin-cmd-detail-section admin-cmd-detail-retry-box">
                    <h4 className="admin-cmd-detail-heading">Retry in progress</h4>
                    <p>
                      Attempt {detail.active_retry.attempt}/{detail.active_retry.max_attempts}
                      {detail.active_retry.next_retry_at &&
                        ` · next at ${fmtTime(detail.active_retry.next_retry_at)}`}
                    </p>
                    {detail.active_retry.last_error && (
                      <pre className="admin-cmd-detail-pre">{detail.active_retry.last_error}</pre>
                    )}
                  </section>
                )}

                {detail.endpoint_stats && (
                  <section className="admin-cmd-detail-section">
                    <h4 className="admin-cmd-detail-heading">Endpoint telemetry (session)</h4>
                    <div className="admin-cmd-detail-grid">
                      <DetailCell label="Total calls" value={String(detail.endpoint_stats.call_count)} />
                      <DetailCell label="Errors" value={String(detail.endpoint_stats.error_count)} />
                      <DetailCell label="Avg latency" value={`${detail.endpoint_stats.avg_latency_ms}ms`} />
                      {detail.endpoint_stats.p95_latency_ms != null && (
                        <DetailCell label="P95 latency" value={`${detail.endpoint_stats.p95_latency_ms}ms`} />
                      )}
                      {detail.endpoint_stats.p99_latency_ms != null && (
                        <DetailCell label="P99 latency" value={`${detail.endpoint_stats.p99_latency_ms}ms`} />
                      )}
                    </div>
                  </section>
                )}

                {detail.chain.length > 1 && (
                  <section className="admin-cmd-detail-section">
                    <h4 className="admin-cmd-detail-heading">Retry chain ({detail.chain.length})</h4>
                    <div className="admin-cmd-chain">
                      {detail.chain.map((ev) => (
                        <div
                          key={ev.id}
                          className={clsx("admin-cmd-chain-step", ev.id === detail.event.id && "admin-cmd-chain-step-active")}
                        >
                          <span className={clsx("admin-api-dot", ev.ok ? "admin-api-dot-ok" : "admin-api-dot-error")} />
                          <span className="admin-cmd-chain-meta">
                            #{ev.attempt} · {ev.status ?? "—"} · {ev.latency_ms}ms
                          </span>
                          <span className="admin-cmd-chain-time">{fmtTime(ev.at)}</span>
                          {!ev.ok && ev.error && <p className="admin-cmd-chain-error">{ev.error.slice(0, 120)}</p>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="admin-cmd-detail-section">
                  <h4 className="admin-cmd-detail-heading">Headers sent</h4>
                  <code className="admin-cmd-detail-code">{detail.event.headers_sent.join(", ") || "—"}</code>
                  <p className="admin-cmd-detail-meta">Correlation {detail.event.correlation_id}</p>
                  <p className="admin-cmd-detail-meta">Event {detail.event.id} · {fmtTime(detail.event.at)} ET</p>
                </section>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DetailCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "error";
}) {
  return (
    <div className="admin-cmd-detail-cell">
      <span className="admin-cmd-detail-label">{label}</span>
      <span
        className={clsx(
          "admin-cmd-detail-value",
          tone === "ok" && "text-[color:var(--admin-green)]",
          tone === "error" && "text-[color:var(--admin-orange)]"
        )}
      >
        {value}
      </span>
    </div>
  );
}
