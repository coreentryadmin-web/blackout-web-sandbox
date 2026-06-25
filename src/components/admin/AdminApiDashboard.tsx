"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { ApiDashboardPayload } from "@/lib/admin-api-dashboard";
import type { AdminHealthPayload } from "@/lib/admin-health";
import type { RegistryEndpointRow } from "@/lib/admin-endpoint-registry";
import {
  ActionButton,
  HealthMeter,
  LivePill,
  MegaStat,
  TabCommandHero,
  WinRateRing,
} from "@/components/admin/AdminUi";
import { AdminApiLiveFeed } from "@/components/admin/AdminApiLiveFeed";
import { AdminApiEventDetail } from "@/components/admin/AdminApiEventDetail";
import { AdminApiCallTimeline } from "@/components/admin/AdminApiCallTimeline";

type ViewTab = "overview" | "registry" | "internal";
type UsageFilter = "all" | "used" | "unused" | "candidates" | "risks";
type ProbeFilter = "all" | "ok" | "fail" | "blocked" | "unknown";
type SortField = "runtime" | "probe" | "ms" | "name";
type SortDir = "asc" | "desc";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtClock(): string {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function probeBadge(status: RegistryEndpointRow["probeStatus"]) {
  const cls = {
    ok: "admin-ep-badge-ok",
    fail: "admin-ep-badge-fail",
    blocked: "admin-ep-badge-blocked",
    rate_limited: "admin-ep-badge-warn",
    unknown: "admin-ep-badge-unknown",
  }[status];
  const label = { ok: "OK", fail: "Fail", blocked: "Blocked", rate_limited: "429", unknown: "—" }[status];
  return <span className={clsx("admin-ep-badge", cls)}>{label}</span>;
}

function runtimeDot(status: RegistryEndpointRow["runtimeStatus"]) {
  const cls = {
    ok: "admin-api-dot-ok",
    error: "admin-api-dot-error",
    idle: "admin-api-dot-idle",
    unconfigured: "admin-api-dot-off",
    unknown: "admin-api-dot-idle",
  }[status];
  return <span className={clsx("admin-api-dot", cls)} title={status} />;
}

/** One cluster rate-limiter card (UW or Polygon). UW reports recent429s; Polygon reports
 *  consecutive429 — accept either so one tile renders both shapes. */
function RateLimiterCard({
  label,
  stats,
}: {
  label: string;
  stats: {
    maxRps: number;
    globalMaxRps: number;
    replicaCount: number;
    degradedLocalRps: number;
    redisGlobal: boolean;
    degraded: boolean;
    circuitOpen: boolean;
    inFlight: number;
    recent429s?: number;
    consecutive429?: number;
  };
}) {
  const recent429 = stats.recent429s ?? stats.consecutive429 ?? 0;
  return (
    <div className={clsx("admin-cmd-ws-card", stats.degraded && "admin-cmd-health-card-fail")}>
      <div className="admin-cmd-ws-card-head">
        <span
          className={clsx(
            "admin-api-dot",
            stats.circuitOpen ? "admin-api-dot-error" : stats.degraded ? "admin-api-dot-idle" : "admin-api-dot-ok"
          )}
        />
        <p className="admin-ep-name">{label}</p>
        {stats.degraded && (
          <span className="admin-outcome-badge admin-outcome-badge-bear">DEGRADED</span>
        )}
        {stats.circuitOpen && (
          <span className="admin-outcome-badge admin-outcome-badge-bear">CIRCUIT OPEN</span>
        )}
      </div>
      <p className="admin-api-muted">
        RPS cap{" "}
        <strong className={stats.degraded ? "admin-cmd-ws-err" : "admin-cmd-ws-ok"}>
          {stats.maxRps.toFixed(2)}
        </strong>{" "}
        / global {stats.globalMaxRps.toFixed(2)}
        {stats.degraded ? ` · local ${stats.degradedLocalRps.toFixed(2)}/replica` : ""}
      </p>
      <p className="admin-api-muted">
        429s (1m){" "}
        <strong className={recent429 > 0 ? "admin-cmd-ws-err" : "admin-cmd-ws-ok"}>{recent429}</strong>
        {" · "}circuit{" "}
        <strong className={stats.circuitOpen ? "admin-cmd-ws-err" : "admin-cmd-ws-ok"}>
          {stats.circuitOpen ? "OPEN" : "closed"}
        </strong>
      </p>
      <p className="admin-api-muted">
        Redis ceiling{" "}
        <strong className={stats.redisGlobal ? "admin-cmd-ws-ok" : "admin-cmd-ws-err"}>
          {stats.redisGlobal ? "on" : "off"}
        </strong>
        {" · "}replicas {stats.replicaCount} · in-flight {stats.inFlight}
      </p>
    </div>
  );
}

export function AdminApiDashboard() {
  const [data, setData] = useState<ApiDashboardPayload | null>(null);
  const [health, setHealth] = useState<AdminHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [viewTab, setViewTab] = useState<ViewTab>("overview");
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [probeFilter, setProbeFilter] = useState<ProbeFilter>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("ms");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    const tick = () => setClock(fmtClock());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async (withProbe = false) => {
    if (withProbe) setProbing(true);
    else if (!data) setLoading(true);
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
  }, [data]);

  // Cluster rate-limiter posture lives in /api/admin/health (rate_limiters.uw/polygon), not the
  // apis/dashboard payload — pull it alongside the telemetry poll so the Rate Limiters tile is live.
  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/health", { cache: "no-store" });
      if (!res.ok) return;
      setHealth(await res.json());
    } catch {
      /* non-fatal — tile renders a placeholder until the next poll succeeds */
    }
  }, []);

  const rescan = useCallback(async () => {
    setRescanning(true);
    try {
      const res = await fetch("/api/admin/apis/rescan", { method: "POST" });
      if (!res.ok) throw new Error("Rescan failed");
      await load(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rescan failed");
    } finally {
      setRescanning(false);
    }
  }, [load]);

  useEffect(() => {
    load(true);
    loadHealth();
    const telemetryId = setInterval(() => load(false), 8_000);
    const probeId = setInterval(() => load(true), 120_000);
    const healthId = setInterval(loadHealth, 8_000);
    return () => {
      clearInterval(telemetryId);
      clearInterval(probeId);
      clearInterval(healthId);
    };
  }, [load, loadHealth]);

  const registry = data?.registry;
  const summary = registry?.summary;
  const providers = registry?.providers ?? [];

  const filteredEndpoints = useMemo(() => {
    if (!registry) return [];
    const q = search.trim().toLowerCase();
    const filtered = registry.endpoints.filter((row) => {
      if (providerFilter !== "all" && row.provider !== providerFilter) return false;
      if (usageFilter === "used" && !row.usedInCode) return false;
      if (usageFilter === "unused" && row.usedInCode) return false;
      if (usageFilter === "candidates" && !row.integrationCandidate) return false;
      if (usageFilter === "risks" && !row.productionRisk) return false;
      if (probeFilter !== "all" && row.probeStatus !== probeFilter) return false;
      if (q) {
        const hay = `${row.name} ${row.pathTemplate} ${row.section} ${row.provider} ${row.sourceFiles.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortField === "name") return a.name.localeCompare(b.name) * dir;
      if (sortField === "probe") return a.probeStatus.localeCompare(b.probeStatus) * dir;
      if (sortField === "runtime") return a.runtimeStatus.localeCompare(b.runtimeStatus) * dir;
      const ams = a.probeMs ?? -1;
      const bms = b.probeMs ?? -1;
      return (ams - bms) * dir;
    });
  }, [registry, providerFilter, usageFilter, probeFilter, search, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir(field === "name" ? "asc" : "desc");
    }
  };

  const coverageRatio = summary && summary.documented_total > 0 ? summary.used_in_code / summary.documented_total : 0;
  const probePassRatio = summary && summary.documented_total > 0 ? summary.probe_ok / summary.documented_total : 0;
  const runtimeSuccess = data?.summary && data.summary.calls_window > 0 ? 1 - data.summary.error_rate / 100 : 1;

  return (
    <div className="admin-api-dashboard admin-deck-root admin-ep-dashboard admin-cmd-root admin-cmd-vivid">
      <TabCommandHero
        kicker="Blackout · API Command Center"
        title="One-Stop"
        titleAccent="API Ops"
        subtitle="265 endpoints · live incident stream · retry forensics · codebase auto-discovery"
        chips={
          <>
            <LivePill label={loading && !data ? "Booting…" : probing ? "Probing…" : `Live · ET ${clock}`} />
            {summary && (
              <>
                <span className="admin-hero-chip">{summary.documented_total} documented</span>
                <span className="admin-hero-chip">{data?.recent_errors.length ?? 0} failures</span>
                <span className="admin-hero-chip">{(data?.active_retries.length ?? 0) > 0 ? `${data?.active_retries.length} retrying` : "stable"}</span>
              </>
            )}
          </>
        }
        actions={
          <>
            <ActionButton onClick={() => load(true)} disabled={probing} variant="primary">
              {probing ? "Probing…" : "Probe providers"}
            </ActionButton>
            <ActionButton onClick={rescan} disabled={rescanning}>
              {rescanning ? "Scanning…" : "Rescan codebase"}
            </ActionButton>
          </>
        }
        rings={
          summary ? (
            <>
              <WinRateRing value={coverageRatio} label="Coverage" sub={`${summary.used_in_code}/${summary.documented_total}`} tone="cyan" size={120} />
              <WinRateRing value={probePassRatio} label="Probe OK" sub={`${summary.probe_ok} live`} tone="bull" size={120} />
              <WinRateRing value={runtimeSuccess} label="Runtime" sub={`${data?.summary.error_rate.toFixed(1) ?? 0}% err`} tone={data && data.summary.error_rate > 10 ? "bear" : "violet"} size={120} />
            </>
          ) : undefined
        }
      />

      {error && <p className="admin-error">{error}</p>}

      {summary && (
        <section className="admin-mega-grid admin-api-stat-grid admin-cmd-stats">
          <MegaStat label="Documented" value={String(summary.documented_total)} sub="polygon + UW" tone="cyan" />
          <MegaStat label="In code" value={String(summary.used_in_code)} sub="auto-scanned" tone="bull" />
          <MegaStat label="Unused" value={String(summary.unused_in_code)} sub="gap analysis" tone="amber" />
          <MegaStat label="Candidates" value={String(summary.integration_candidates)} sub="unused + OK" tone="violet" />
          <MegaStat label="Risks" value={String(summary.production_risks)} sub="used + blocked" tone="bear" trend={summary.production_risks > 0 ? "down" : "flat"} />
          <MegaStat label={`Calls (${summary.window_label})`} value={String(summary.runtime_calls_window)} sub="telemetry" tone="neutral" />
        </section>
      )}

      <div className="admin-cmd-split">
        <AdminApiLiveFeed
          initialErrors={data?.recent_errors ?? []}
          activeRetries={data?.active_retries ?? []}
          selectedId={selectedEventId}
          onSelect={setSelectedEventId}
        />

        <div className="admin-cmd-main">
          {providers.length > 0 && (
            <section className="admin-ep-provider-strip admin-cmd-provider-strip">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={clsx("admin-ep-provider-chip", providerFilter === p.id && "admin-ep-provider-chip-active")}
                  onClick={() => setProviderFilter((cur) => (cur === p.id ? "all" : p.id))}
                >
                  <span className="admin-ep-provider-chip-name">{p.name}</span>
                  <span className="admin-ep-provider-chip-stats">{p.usedTotal}/{p.documentedTotal} used · {p.probeOk} OK</span>
                  {p.configured && p.telemetryCalls > 0 && (
                    <HealthMeter label="" value={Math.max(0, 100 - (p.telemetryErrors / Math.max(1, p.telemetryCalls)) * 100)} tone="bull" />
                  )}
                </button>
              ))}
            </section>
          )}

          <div className="admin-ep-toolbar admin-cmd-tabs">
            <div className="admin-provider-tabs">
              {(["overview", "registry", "internal"] as const).map((tab) => (
                <button key={tab} type="button" className={viewTab === tab ? "admin-vivid-tab-active" : "admin-vivid-tab"} onClick={() => setViewTab(tab)}>
                  {tab === "overview" ? "Overview" : tab === "registry" ? `Registry (${registry?.endpoints.length ?? 0})` : `Internal (${registry?.internalRoutes.length ?? 0})`}
                </button>
              ))}
            </div>
          </div>

          {viewTab === "overview" && data && (
            <>
              <AdminApiCallTimeline events={data.recent_events} selectedId={selectedEventId} onSelect={setSelectedEventId} />
              <section className="admin-cmd-ws-status">
                <h3 className="admin-cmd-ws-title">WebSocket status</h3>
                <div className="admin-cmd-ws-grid">
                  <div className="admin-cmd-ws-card">
                    <div className="admin-cmd-ws-card-head">
                      <span className={clsx("admin-api-dot", data.websockets.polygon_indices.authenticated ? "admin-api-dot-ok" : "admin-api-dot-error")} />
                      <p className="admin-ep-name">Polygon Indices</p>
                    </div>
                    <p className="admin-api-muted">
                      State: <strong>{data.websockets.polygon_indices.wsState}</strong>
                    </p>
                    <p className="admin-api-muted">
                      Auth: <strong className={data.websockets.polygon_indices.authenticated ? "admin-cmd-ws-ok" : "admin-cmd-ws-err"}>{data.websockets.polygon_indices.authenticated ? "Authenticated" : "Not auth"}</strong>
                    </p>
                    <p className="admin-api-muted">
                      {data.websockets.polygon_indices.symbols.length} symbols tracked
                      {data.websockets.polygon_indices.symbols.length > 0 && (
                        <span className="admin-cmd-ws-symbols"> · {data.websockets.polygon_indices.symbols.slice(0, 3).map(s => s.sym).join(", ")}{data.websockets.polygon_indices.symbols.length > 3 ? "…" : ""}</span>
                      )}
                    </p>
                  </div>
                  <div className="admin-cmd-ws-card">
                    <div className="admin-cmd-ws-card-head">
                      <span className={clsx("admin-api-dot",
                        Object.values(data.websockets.unusual_whales.channels).some(c => c.authenticated) ? "admin-api-dot-ok" : "admin-api-dot-error"
                      )} />
                      <p className="admin-ep-name">Unusual Whales</p>
                    </div>
                    {Object.entries(data.websockets.unusual_whales.channels).map(([ch, row]) => (
                      <p key={ch} className="admin-api-muted">
                        <span className={row.authenticated ? "admin-cmd-ws-ok" : "admin-cmd-ws-err"}>●</span>{" "}
                        {ch}: <strong>{row.ws_state}</strong>
                        {!row.authenticated && <span className="admin-cmd-ws-err"> · no auth</span>}
                      </p>
                    ))}
                  </div>
                </div>
              </section>
              {health && (
                <section className="admin-cmd-ws-status">
                  <h3 className="admin-cmd-ws-title">Rate limiters · cluster</h3>
                  <div className="admin-cmd-ws-grid">
                    <RateLimiterCard label="Unusual Whales" stats={health.rate_limiters.uw} />
                    <RateLimiterCard label="Polygon / Massive" stats={health.rate_limiters.polygon} />
                  </div>
                </section>
              )}
              <section className="admin-cmd-ops-grid">
                <div className="admin-cmd-ws-card">
                  <p className="admin-ep-name">Postgres pool</p>
                  <p className="admin-api-muted">
                    {data.ops.db_pool?.configured
                      ? `${data.ops.db_pool.total} total · ${data.ops.db_pool.idle} idle · ${data.ops.db_pool.waiting} waiting`
                      : "Not configured"}
                  </p>
                </div>
                <div className="admin-cmd-ws-card">
                  <p className="admin-ep-name">Play engine heartbeat</p>
                  <p className="admin-api-muted">
                    {data.ops.play_engine.heartbeat.last_tick_at
                      ? `Last tick ${Math.round((data.ops.play_engine.heartbeat.age_ms ?? 0) / 1000)}s ago · ${data.ops.play_engine.heartbeat.tick_count} ticks`
                      : "No ticks this session"}
                  </p>
                  <p className="admin-api-muted">
                    source {data.ops.play_engine.heartbeat.last_source ?? "—"}
                    {data.ops.play_engine.heartbeat.stale ? " · STALE" : ""}
                  </p>
                </div>
              </section>
              {data.ops.rate_headroom.length > 0 && (
                <section className="admin-cmd-rate-headroom">
                  <h3 className="admin-cmd-ws-title">Rate limit headroom (1m)</h3>
                  <div className="admin-cmd-rate-grid">
                    {data.ops.rate_headroom.map((row) => (
                      <div key={row.provider} className={clsx("admin-cmd-rate-card", `admin-cmd-rate-${row.status}`)}>
                        <div className="admin-cmd-rate-head">
                          <span className="admin-ep-name">{row.provider}</span>
                          <span className="admin-api-muted">
                            {row.used_1m}/{row.limit_1m}
                          </span>
                        </div>
                        <div className="admin-cmd-rate-bar">
                          <span className="admin-cmd-rate-fill" style={{ width: `${Math.min(100, row.pct)}%` }} />
                        </div>
                        <p className="admin-api-muted">{row.headroom} req headroom · {row.label}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {data.cluster && data.cluster.instances_reporting > 0 && (
                <section className="admin-cmd-ws-status">
                  <h3 className="admin-cmd-ws-title">
                    Cluster · {data.cluster.instances_reporting} replica{data.cluster.instances_reporting === 1 ? "" : "s"} reporting (5m)
                  </h3>
                  <div className="admin-cmd-ws-grid">
                    {Object.entries(data.cluster.by_provider).map(([provider, stats]) => {
                      const calls = stats?.cross_calls_5m ?? 0;
                      const errors = stats?.cross_errors_5m ?? 0;
                      const rl = data.cluster?.rate_limits?.[provider as keyof typeof data.cluster.rate_limits] ?? 0;
                      return (
                        <div key={provider} className="admin-cmd-ws-card">
                          <p className="admin-ep-name">{provider}</p>
                          <p className="admin-api-muted">
                            <strong className="admin-cmd-ws-ok">{calls}</strong> calls ·{" "}
                            <strong className={errors > 0 ? "admin-cmd-ws-err" : "admin-cmd-ws-ok"}>{errors}</strong> err
                            {rl > 0 ? <span className="admin-cmd-ws-err"> · {rl} rate-limited</span> : null}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
              <section className="admin-cmd-provider-health">
                {data.providers.map((p) => {
                  const latency = p.endpoints.find((ep) => ep.telemetry?.p95_latency_ms)?.telemetry;
                  const errorRate = p.telemetry.calls > 0 ? ((p.telemetry.errors / p.telemetry.calls) * 100).toFixed(1) : "0.0";
                  return (
                  <div key={p.id} className={clsx("admin-cmd-health-card", !p.probe.ok && "admin-cmd-health-card-fail")}>
                    <span className={clsx("admin-api-dot", p.probe.ok ? "admin-api-dot-ok" : "admin-api-dot-error")} />
                    <div className="admin-cmd-health-body">
                      <p className="admin-ep-name">{p.name}</p>
                      <p className="admin-api-muted">
                        {p.telemetry.calls} calls · {p.telemetry.errors} err · {errorRate}% error rate
                        {latency?.p95_latency_ms ? ` · p95 ${latency.p95_latency_ms}ms` : ""}
                        {latency?.p99_latency_ms ? ` · p99 ${latency.p99_latency_ms}ms` : ""}
                      </p>
                      {!p.probe.ok && p.probe.error && (
                        <p className="admin-cmd-health-error">{p.probe.error}</p>
                      )}
                      {p.probe.latency_ms != null && (
                        <p className="admin-api-muted">Probe latency: {p.probe.latency_ms}ms</p>
                      )}
                    </div>
                    <span className={clsx("admin-cmd-health-status", p.probe.ok ? "admin-cmd-health-ok" : "admin-cmd-health-down")}>
                      {p.probe.ok ? "Healthy" : "Down"}
                    </span>
                  </div>
                  );
                })}
              </section>
            </>
          )}

          {viewTab === "registry" && (
            <>
              <div className="admin-cmd-registry-filters">
                <input type="search" className="admin-ep-search" placeholder="Search endpoints…" aria-label="Search endpoints" value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="admin-provider-tabs admin-ep-filter-tabs">
                  {(["all", "used", "unused", "candidates", "risks"] as const).map((f) => (
                    <button key={f} type="button" className={usageFilter === f ? "admin-vivid-tab-active" : "admin-vivid-tab"} onClick={() => setUsageFilter(f)}>{f}</button>
                  ))}
                </div>
                <div className="admin-provider-tabs admin-ep-filter-tabs">
                  {(["all", "ok", "fail", "blocked", "unknown"] as const).map((f) => (
                    <button key={f} type="button" className={probeFilter === f ? "admin-vivid-tab-active" : "admin-vivid-tab"} onClick={() => setProbeFilter(f)}>{f}</button>
                  ))}
                </div>
              </div>
              <section className="admin-ep-table-section">
                <div className="admin-scroll-table admin-table-wrap">
                  <table className="admin-table admin-table-pro admin-ep-table">
                    <thead>
                      <tr>
                        <th>
                          <button type="button" className="admin-ep-sort" onClick={() => toggleSort("runtime")}>
                            RT {sortField === "runtime" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                          </button>
                        </th>
                        <th>Usage</th>
                        <th>
                          <button type="button" className="admin-ep-sort" onClick={() => toggleSort("probe")}>
                            Probe {sortField === "probe" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                          </button>
                        </th>
                        <th>Provider</th>
                        <th>Section</th>
                        <th>
                          <button type="button" className="admin-ep-sort" onClick={() => toggleSort("name")}>
                            Name {sortField === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                          </button>
                        </th>
                        <th>Path</th>
                        <th>HTTP</th>
                        <th>
                          <button type="button" className="admin-ep-sort" onClick={() => toggleSort("ms")}>
                            ms {sortField === "ms" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEndpoints.map((row) => (
                        <tr key={row.id} className={clsx(row.productionRisk && "admin-ep-row-risk", row.integrationCandidate && "admin-ep-row-candidate")}>
                          <td>{runtimeDot(row.runtimeStatus)}</td>
                          <td><span className={row.usedInCode ? "admin-ep-used" : "admin-ep-unused"}>{row.usedInCode ? "used" : "unused"}</span></td>
                          <td>{probeBadge(row.probeStatus)}</td>
                          <td className="admin-ep-provider">{row.providerLabel}</td>
                          <td className="admin-ep-section">{row.section}</td>
                          <td className="admin-ep-name">{row.name}</td>
                          <td><code className="admin-api-mono admin-api-endpoint">{row.pathTemplate}</code></td>
                          <td className="admin-api-mono">{row.probeHttp ?? "—"}</td>
                          <td className="admin-api-mono">{row.probeMs ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="admin-ep-count">Showing {filteredEndpoints.length} of {registry?.endpoints.length ?? 0}</p>
              </section>
            </>
          )}

          {viewTab === "internal" && registry && (
            <section className="admin-ep-table-section">
              <div className="admin-scroll-table admin-table-wrap">
                <table className="admin-table admin-table-pro admin-ep-table">
                  <thead><tr><th>Method</th><th>Path</th><th>File</th></tr></thead>
                  <tbody>
                    {registry.internalRoutes.map((route) => (
                      <tr key={`${route.method}-${route.path}`}>
                        <td><span className="docs-rest-method">{route.method}</span></td>
                        <td><code className="admin-api-mono">{route.path}</code></td>
                        <td><code className="admin-file-ref">{route.file.replace(/^src\//, "")}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>

      <AdminApiEventDetail eventId={selectedEventId} onClose={() => setSelectedEventId(null)} />

      {registry && (
        <p className="admin-api-footer">
          Scan {fmtTime(registry.codebase_scanned_at)} · Probe {registry.probe_completed_at ? fmtTime(registry.probe_completed_at) : "—"} · SSE incident stream · Click any failure for deep dive
        </p>
      )}
    </div>
  );
}
