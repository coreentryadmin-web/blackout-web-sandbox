"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import type { ApiDashboardPayload, ProviderDashboardRow } from "@/lib/admin-api-dashboard";

function statusDot(status: string): string {
  switch (status) {
    case "ok":
      return "admin-api-dot-ok";
    case "error":
      return "admin-api-dot-error";
    case "unconfigured":
      return "admin-api-dot-off";
    default:
      return "admin-api-dot-idle";
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtLatency(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${ms}ms`;
}

function ProviderCard({
  provider,
  expanded,
  onToggle,
}: {
  provider: ProviderDashboardRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const healthClass = !provider.configured
    ? "admin-api-card-off"
    : provider.probe.ok
      ? "admin-api-card-ok"
      : provider.probe.at
        ? "admin-api-card-error"
        : "admin-api-card-idle";

  return (
    <article className={clsx("admin-api-card", healthClass, expanded && "admin-api-card-open")}>
      <button type="button" className="admin-api-card-head" onClick={onToggle}>
        <div className="admin-api-card-title-row">
          <span className={clsx("admin-api-dot", statusDot(provider.probe.ok ? "ok" : provider.configured ? "error" : "unconfigured"))} />
          <div>
            <h3 className="admin-api-card-title">{provider.name}</h3>
            <p className="admin-api-card-desc">{provider.description}</p>
          </div>
        </div>
        <div className="admin-api-card-meta">
          <span>{provider.configured ? "Configured" : "Not configured"}</span>
          <span>{provider.telemetry.calls} calls</span>
          {provider.telemetry.errors > 0 && (
            <span className="admin-api-meta-error">{provider.telemetry.errors} errors</span>
          )}
          <span className="admin-api-chevron">{expanded ? "▾" : "▸"}</span>
        </div>
      </button>

      {expanded && (
        <div className="admin-api-card-body">
          <div className="admin-api-probe-row">
            <span className="admin-api-probe-label">Live probe</span>
            {provider.probe.at ? (
              <>
                <span className={clsx("admin-api-badge", provider.probe.ok ? "admin-api-badge-ok" : "admin-api-badge-error")}>
                  {provider.probe.ok ? "Healthy" : "Failed"}
                </span>
                <span>{fmtLatency(provider.probe.latency_ms)}</span>
                <span>{fmtTime(provider.probe.at)}</span>
                {provider.probe.error && (
                  <span className="admin-api-probe-error">{provider.probe.error}</span>
                )}
              </>
            ) : (
              <span className="admin-api-muted">Run refresh with probe to check live status</span>
            )}
          </div>

          {provider.env_keys.length > 0 && (
            <p className="admin-api-env">
              Env: {provider.env_keys.map((k) => (
                <code key={k}>{k}</code>
              ))}
            </p>
          )}

          {provider.docs_url && (
            <a href={provider.docs_url} target="_blank" rel="noreferrer" className="admin-api-docs-link">
              API docs ↗
            </a>
          )}

          <div className="admin-scroll-table">
            <table className="admin-table admin-api-endpoint-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Method</th>
                  <th>Endpoint</th>
                  <th>Last</th>
                  <th>Latency</th>
                  <th>Errors</th>
                  <th>Used by</th>
                </tr>
              </thead>
              <tbody>
                {provider.endpoints.map((ep) => (
                  <tr key={`${ep.method}-${ep.endpoint}`}>
                    <td>
                      <span className={clsx("admin-api-dot", statusDot(ep.status))} title={ep.status} />
                    </td>
                    <td className="admin-api-mono">{ep.method}</td>
                    <td className="admin-api-mono admin-api-endpoint">{ep.endpoint}</td>
                    <td>{fmtTime(ep.telemetry?.last_at ?? null)}</td>
                    <td>{fmtLatency(ep.telemetry?.last_latency_ms)}</td>
                    <td>
                      {ep.telemetry?.error_count ? (
                        <span className="admin-api-meta-error">{ep.telemetry.error_count}</span>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="admin-api-used-by">{ep.used_by.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {provider.endpoints.some((e) => e.telemetry?.last_error) && (
            <div className="admin-api-endpoint-errors">
              <p className="admin-section-title">Endpoint errors</p>
              <ul>
                {provider.endpoints
                  .filter((e) => e.telemetry?.last_error)
                  .map((e) => (
                    <li key={`err-${e.endpoint}`}>
                      <code>{e.endpoint}</code> — {e.telemetry?.last_error}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function AdminApiDashboard() {
  const [data, setData] = useState<ApiDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (withProbe = false) => {
    if (withProbe) setProbing(true);
    else setLoading(true);
    setError(null);
    try {
      const qs = withProbe ? "?probe=1" : "";
      const res = await fetch(`/api/admin/apis/dashboard${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 403 ? "Not authorized" : `HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const telemetryId = setInterval(() => load(false), 5_000);
    const probeId = setInterval(() => load(true), 60_000);
    return () => {
      clearInterval(telemetryId);
      clearInterval(probeId);
    };
  }, [load]);

  const summary = data?.summary;

  return (
    <div className="admin-api-dashboard">
      <header className="admin-api-toolbar">
        <div>
          <h2 className="admin-section-title">API Command Center</h2>
          <p className="admin-sub">
            Real-time outbound API telemetry · live health probes · endpoint error tracking
          </p>
        </div>
        <div className="admin-api-toolbar-actions">
          <span className="admin-api-live">
            <span className="admin-api-live-dot" />
            {loading && !data ? "Loading…" : probing ? "Probing…" : "Live · 5s"}
          </span>
          <button type="button" className="admin-refresh-btn" onClick={() => load(true)} disabled={probing}>
            {probing ? "Probing…" : "Probe all APIs"}
          </button>
        </div>
      </header>

      {error && <p className="admin-error">{error}</p>}

      {summary && (
        <section className="admin-stat-grid admin-api-stat-grid">
          <div className="admin-stat-card">
            <p className="admin-stat-label">Providers</p>
            <p className="admin-stat-value">
              {summary.providers_healthy}/{summary.providers_configured}
            </p>
            <p className="admin-stat-sub">healthy / configured</p>
          </div>
          <div className="admin-stat-card">
            <p className="admin-stat-label">Calls ({summary.window_label})</p>
            <p className="admin-stat-value">{summary.calls_window}</p>
          </div>
          <div className="admin-stat-card admin-stat-bear">
            <p className="admin-stat-label">Errors ({summary.window_label})</p>
            <p className="admin-stat-value">{summary.errors_window}</p>
          </div>
          <div className="admin-stat-card">
            <p className="admin-stat-label">Error rate</p>
            <p className="admin-stat-value">{summary.error_rate.toFixed(1)}%</p>
          </div>
        </section>
      )}

      <section className="admin-api-provider-grid">
        {data?.providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            expanded={expanded === p.id}
            onToggle={() => setExpanded((cur) => (cur === p.id ? null : p.id))}
          />
        ))}
      </section>

      {data && (data.recent_errors.length > 0 || data.recent_events.length > 0) && (
        <section className="admin-two-col">
          <div className="admin-panel">
            <h3 className="admin-section-title">Recent errors</h3>
            {data.recent_errors.length === 0 ? (
              <p className="admin-api-muted">No errors in the current window.</p>
            ) : (
              <div className="admin-scroll-table">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Provider</th>
                      <th>Endpoint</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_errors.map((e) => (
                      <tr key={e.id}>
                        <td>{fmtTime(e.at)}</td>
                        <td>{e.provider}</td>
                        <td className="admin-api-mono">{e.endpoint}</td>
                        <td className="admin-api-meta-error">{e.error ?? `HTTP ${e.status}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="admin-panel">
            <h3 className="admin-section-title">Recent calls</h3>
            <div className="admin-scroll-table">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Provider</th>
                    <th>Endpoint</th>
                    <th>Status</th>
                    <th>ms</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_events.slice(0, 30).map((e) => (
                    <tr key={e.id}>
                      <td>{fmtTime(e.at)}</td>
                      <td>{e.provider}</td>
                      <td className="admin-api-mono">{e.endpoint}</td>
                      <td>
                        <span className={clsx("admin-api-dot", statusDot(e.ok ? "ok" : "error"))} />
                        {e.status ?? "—"}
                      </td>
                      <td>{e.latency_ms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {data && (
        <p className="admin-api-footer">
          Last updated {fmtTime(data.generated_at)} · Telemetry window {data.summary.window_label} ·
          Probes refresh every 60s
        </p>
      )}
    </div>
  );
}
