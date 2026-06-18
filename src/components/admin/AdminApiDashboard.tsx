"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import type { ApiDashboardPayload, ProviderDashboardRow } from "@/lib/admin-api-dashboard";
import { ActionButton, DataTable, HealthMeter, LivePill, MegaStat, TabCommandHero, WinRateRing } from "@/components/admin/AdminUi";

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

  const errorRate =
    provider.telemetry.calls > 0 ? (provider.telemetry.errors / provider.telemetry.calls) * 100 : 0;
  const successRate = Math.max(0, 100 - errorRate);

  return (
    <article className={clsx("admin-api-card admin-provider-card admin-deck-panel-wrap", healthClass, expanded && "admin-api-card-open admin-deck-open")}>
      <div className="admin-provider-strip admin-deck-strip" aria-hidden />
      <button type="button" className="admin-api-card-head admin-deck-head" onClick={onToggle}>
        <div className="admin-api-card-title-row">
          <span className={clsx("admin-api-dot", statusDot(provider.probe.ok ? "ok" : provider.configured ? "error" : "unconfigured"))} />
          <div>
            <h3 className="admin-api-card-title admin-deck-head-title">{provider.name}</h3>
            <p className="admin-api-card-desc">{provider.description}</p>
          </div>
        </div>
        <div className="admin-api-card-meta">
          <span className="admin-deck-badge">{provider.configured ? "Configured" : "Not configured"}</span>
          <span>{provider.telemetry.calls} calls</span>
          {provider.telemetry.errors > 0 && (
            <span className="admin-api-meta-error">{provider.telemetry.errors} errors</span>
          )}
          <span className="admin-deck-chevron">{expanded ? "▾" : "▸"}</span>
        </div>
      </button>

      {!expanded && provider.configured && provider.telemetry.calls > 0 && (
        <div className="admin-provider-meter px-5 pb-4 pl-6">
          <HealthMeter
            label="Success rate"
            value={successRate}
            tone={successRate >= 90 ? "bull" : successRate >= 70 ? "amber" : "bear"}
          />
        </div>
      )}

      {expanded && (
        <div className="admin-api-card-body admin-deck-body">
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

          <div className="admin-scroll-table admin-table-wrap">
            <table className="admin-table admin-table-pro admin-api-endpoint-table">
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
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleString("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

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
  const healthRatio =
    summary && summary.providers_configured > 0
      ? summary.providers_healthy / summary.providers_configured
      : 0;
  const successRatio = summary ? Math.max(0, 1 - summary.error_rate / 100) : 0;
  const configuredRatio =
    summary && summary.providers_total > 0 ? summary.providers_configured / summary.providers_total : 0;

  return (
    <div className="admin-api-dashboard admin-deck-root">
      <TabCommandHero
        kicker="Blackout · API Telemetry"
        title="API"
        titleAccent="Grid"
        subtitle="Real-time outbound probes · provider health · endpoint errors · latency tracking"
        chips={
          <>
            <LivePill label={loading && !data ? "Loading…" : probing ? "Probing…" : `Live · 5s · ET ${clock}`} />
            {summary && (
              <span className="admin-hero-chip">
                {summary.providers_healthy}/{summary.providers_configured} healthy
              </span>
            )}
          </>
        }
        actions={
          <ActionButton onClick={() => load(true)} disabled={probing} variant="primary">
            {probing ? "Probing…" : "Probe all APIs"}
          </ActionButton>
        }
        rings={
          summary ? (
            <>
              <WinRateRing
                value={healthRatio}
                label="Healthy"
                sub={`${summary.providers_healthy}/${summary.providers_configured}`}
                tone="bull"
                size={96}
              />
              <WinRateRing
                value={successRatio}
                label="Success"
                sub={`${summary.error_rate.toFixed(1)}% err`}
                tone={summary.error_rate > 10 ? "bear" : "cyan"}
                size={96}
              />
              <WinRateRing
                value={configuredRatio}
                label="Configured"
                sub={`${summary.providers_configured}/${summary.providers_total}`}
                tone="violet"
                size={96}
              />
            </>
          ) : undefined
        }
      />

      {error && <p className="admin-error">{error}</p>}

      {summary && (
        <section className="admin-mega-grid admin-api-stat-grid">
          <MegaStat
            label="Providers healthy"
            value={`${summary.providers_healthy}/${summary.providers_configured}`}
            sub="live probe pass"
            tone="bull"
            bar={(summary.providers_healthy / Math.max(1, summary.providers_configured)) * 100}
          />
          <MegaStat
            label={`Calls (${summary.window_label})`}
            value={String(summary.calls_window)}
            sub="outbound requests"
            tone="cyan"
          />
          <MegaStat
            label={`Errors (${summary.window_label})`}
            value={String(summary.errors_window)}
            sub="failed / non-2xx"
            tone="bear"
            trend={summary.errors_window > 0 ? "down" : "flat"}
          />
          <MegaStat
            label="Error rate"
            value={`${summary.error_rate.toFixed(1)}%`}
            sub="rolling window"
            tone={summary.error_rate > 10 ? "bear" : "amber"}
            bar={summary.error_rate}
          />
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
          <div className="admin-panel admin-glass admin-glass-bear">
            <h3 className="admin-glass-title admin-deck-title">Recent errors</h3>
            {data.recent_errors.length === 0 ? (
              <p className="admin-api-muted">No errors in the current window.</p>
            ) : (
              <DataTable>
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
                      <td className="admin-td-strong">{e.provider}</td>
                      <td className="admin-api-mono">{e.endpoint}</td>
                      <td className="admin-api-meta-error">{e.error ?? `HTTP ${e.status}`}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </div>

          <div className="admin-panel admin-glass admin-glass-cyan">
            <h3 className="admin-glass-title admin-deck-title">Recent calls</h3>
            <DataTable>
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
                    <td className="admin-td-strong">{e.provider}</td>
                    <td className="admin-api-mono">{e.endpoint}</td>
                    <td>
                      <span className={clsx("admin-api-dot", statusDot(e.ok ? "ok" : "error"))} />
                      {e.status ?? "—"}
                    </td>
                    <td>{e.latency_ms}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
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
