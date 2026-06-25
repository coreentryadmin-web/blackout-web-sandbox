"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { CronHealthPayload, CronJobHealth } from "@/lib/admin-cron-health";
import {
  ActionButton,
  DeckPanel,
  EmptyDeck,
  GlassPanel,
  HealthMeter,
  HorzBar,
  LivePill,
  MetricChip,
  SectionDeck,
  TabCommandHero,
  WinRateRing,
} from "@/components/admin/AdminUi";

const JOB_ICONS: Record<string, string> = {
  "flow-ingest": "⬡",
  "spx-evaluate": "◎",
  "largo-cleanup": "◆",
  "nighthawk-outcomes": "◈",
  "nighthawk-playbook": "⏱",
};

// Crons the admin run/warm endpoint (/api/admin/cron/run) can dispatch. Keep in sync with
// CRON_DISPATCH in src/lib/cron-dispatch.ts — only these show a "Run now" button.
const RUNNABLE_CRONS = new Set([
  "flow-ingest",
  "uw-cache-refresh",
  "nights-watch-warm",
  "heatmap-warm",
]);

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

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function fmtAge(min: number | null): string {
  if (min == null) return "never";
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / (24 * 60))}d ago`;
}

function statusTone(status: CronJobHealth["status"]): "bull" | "bear" | "amber" | "cyan" | "violet" {
  if (status === "healthy") return "bull";
  if (status === "failed") return "bear";
  if (status === "stale") return "amber";
  if (status === "warning") return "cyan";
  return "violet";
}

function statusLabel(status: CronJobHealth["status"]): string {
  return {
    healthy: "ONLINE",
    warning: "CAUTION",
    stale: "STALE",
    failed: "FAILED",
    unknown: "DARK",
  }[status];
}

function nhJobMeta(job: CronJobHealth): string | null {
  const nh = job.meta?.nighthawk_job as
    | { edition_for?: string; status?: string; current_stage?: string; error?: string | null }
    | undefined;
  if (!nh) return null;
  if (nh.error) return nh.error;
  if (nh.status && nh.current_stage) return `${nh.status} · ${nh.current_stage}`;
  if (nh.status && nh.edition_for) return `${nh.status} · ${nh.edition_for}`;
  return nh.status ?? null;
}

function RunNowButton({ job, onRan }: { job: CronJobHealth; onRan: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/cron/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ name: job.key }),
      });
      const data = await res.json().catch(() => null);
      const ok = res.ok && data?.ok !== false;
      const inner = data?.result;
      const summary =
        inner && typeof inner === "object"
          ? Object.entries(inner)
              .filter(([k]) => k !== "ok")
              .slice(0, 4)
              .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
              .join(" · ")
          : typeof inner === "string"
            ? inner.slice(0, 120)
            : "";
      const dur = typeof data?.durationMs === "number" ? ` (${fmtDuration(data.durationMs)})` : "";
      setResult({
        ok,
        text: ok
          ? `Ran${dur}${summary ? ` — ${summary}` : ""}`
          : `Failed — ${data?.detail ?? data?.error ?? `HTTP ${res.status}`}`,
      });
      onRan();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setRunning(false);
    }
  }, [job.key, onRan]);

  return (
    <div className="admin-cron-card-run">
      <ActionButton variant="primary" onClick={run} disabled={running}>
        {running ? "Warming…" : "Run now"}
      </ActionButton>
      {result && (
        <p
          className={clsx(
            "admin-cron-card-run-result",
            result.ok ? "admin-cron-card-run-ok" : "admin-cron-card-run-fail"
          )}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}

function CronJobCard({
  job,
  index,
  onRan,
}: {
  job: CronJobHealth;
  index: number;
  onRan: () => void;
}) {
  // A market-hours warmer stale DURING RTH is a live-data emergency (#90), not a soft "amber"
  // staleness — paint it red so it's impossible to miss on the fleet grid.
  const tone = job.market_hours_stale ? "bear" : statusTone(job.status);
  const total24 = job.runs_24h.ok + job.runs_24h.failed + job.runs_24h.skipped;
  const okShare = total24 > 0 ? job.runs_24h.ok / total24 : 0;
  const extra = nhJobMeta(job);
  const runnable = RUNNABLE_CRONS.has(job.key);

  return (
    <article
      className={clsx(
        "admin-cron-card",
        `admin-cron-card-${job.status}`,
        `admin-cron-card-tone-${tone}`
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="admin-cron-card-glow" aria-hidden />
      <div className="admin-cron-card-scan" aria-hidden />

      <header className="admin-cron-card-head">
        <div className="admin-cron-card-icon">{JOB_ICONS[job.key] ?? "◉"}</div>
        <div className="admin-cron-card-titles">
          <h3 className="admin-cron-card-name">{job.name}</h3>
          <p className="admin-cron-card-path">
            {job.kind === "http" ? job.path : "Railway worker"}
          </p>
        </div>
        <span className={clsx("admin-cron-card-badge", `admin-cron-card-badge-${tone}`)}>
          <span className={clsx("admin-cron-card-dot", job.status === "healthy" && "admin-cron-card-dot-pulse")} />
          {job.market_hours_stale ? "RTH-STALE" : statusLabel(job.status)}
        </span>
      </header>

      <p className="admin-cron-card-desc">{job.description}</p>

      <div className="admin-cron-card-meta">
        <span className="admin-cron-card-pill">{job.schedule_label}</span>
        <span className="admin-cron-card-pill admin-cron-card-pill-dim">
          {job.kind === "http" ? "HTTP" : "WORKER"}
        </span>
      </div>

      <div className="admin-cron-card-stats">
        <div className="admin-cron-card-stat">
          <span className="admin-cron-card-stat-label">Last tick</span>
          <span className="admin-cron-card-stat-value">{fmtTime(job.last_run_at)}</span>
          <span className="admin-cron-card-stat-sub">{fmtAge(job.age_min)}</span>
        </div>
        <div className="admin-cron-card-stat">
          <span className="admin-cron-card-stat-label">Duration</span>
          <span className="admin-cron-card-stat-value">{fmtDuration(job.last_duration_ms)}</span>
        </div>
        <div className="admin-cron-card-stat">
          <span className="admin-cron-card-stat-label">24h</span>
          <span className="admin-cron-card-stat-value admin-cron-card-stat-mono">
            <span className="admin-cron-count-ok">{job.runs_24h.ok}</span>
            <span className="admin-cron-card-stat-sep">/</span>
            <span className="admin-cron-count-fail">{job.runs_24h.failed}</span>
            <span className="admin-cron-card-stat-sep">/</span>
            <span className="admin-cron-count-skip">{job.runs_24h.skipped}</span>
          </span>
          <span className="admin-cron-card-stat-sub">ok · fail · skip</span>
        </div>
        <div className="admin-cron-card-stat">
          <span className="admin-cron-card-stat-label">Stale limit</span>
          <span className="admin-cron-card-stat-value">
            {job.effective_stale_min ?? job.stale_after_min}m
            {job.stale_multiplier != null && job.stale_multiplier > 1 && (
              <span className="admin-cron-card-stale-mult" title={`${job.stale_multiplier}× relaxed (off-schedule)`}>
                ×{job.stale_multiplier}
              </span>
            )}
          </span>
          <span className="admin-cron-card-stat-sub">
            {job.stale_multiplier != null && job.stale_multiplier > 1 ? "weekend relax" : "effective now"}
          </span>
        </div>
      </div>

      <HorzBar
        label="24h success mix"
        value={okShare}
        max={1}
        tone={tone === "violet" ? "cyan" : tone}
        right={total24 > 0 ? `${Math.round(okShare * 100)}%` : "—"}
      />

      <p className="admin-cron-card-detail">{job.status_label}</p>
      {extra && <p className="admin-cron-card-detail-sub">{extra}</p>}

      {runnable && <RunNowButton job={job} onRan={onRan} />}
    </article>
  );
}

function RecentRunsFeed({ events }: { events: CronHealthPayload["recent_events"] }) {
  if (!events.length) {
    return (
      <EmptyDeck
        title="No telemetry yet"
        hint="Runs stream in when HTTP crons hit blackout-web or the Night Hawk worker completes."
      />
    );
  }

  return (
    <ul className="admin-cron-feed">
      {events.map((ev, i) => {
        const tone =
          ev.status === "ok" ? "bull" : ev.status === "failed" ? "bear" : ev.status === "skipped" ? "amber" : "violet";
        return (
          <li
            key={`${ev.job_key}-${ev.started_at}-${i}`}
            className={clsx("admin-cron-feed-row", `admin-cron-feed-row-${tone}`)}
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <span className="admin-cron-feed-time">{fmtTime(ev.started_at)}</span>
            <span className="admin-cron-feed-job">{ev.job_name}</span>
            <span className={clsx("admin-cron-feed-status", `admin-cron-feed-status-${tone}`)}>
              {ev.status}
            </span>
            <span className="admin-cron-feed-msg">{ev.message ?? "—"}</span>
            <span className="admin-cron-feed-dur">{fmtDuration(ev.duration_ms)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function AdminCronDashboard() {
  const [data, setData] = useState<CronHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [ageSec, setAgeSec] = useState(0);
  const [pulse, setPulse] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/cron-health", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 403 ? "Not authorized" : `HTTP ${res.status}`);
      setData(await res.json());
      setAgeSec(0);
      setPulse(true);
      setTimeout(() => setPulse(false), 600);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(() => load(), 10_000);
    const tick = setInterval(() => setAgeSec((s) => s + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const healthyPct = useMemo(
    () => (data?.summary.total ? data.summary.healthy / data.summary.total : 0),
    [data]
  );

  // The #90 blind spot, made loud: market-hours warmers stale RIGHT NOW during RTH. When any
  // exist we render a red alert strip above everything else so it can never be invisible again.
  const rthStaleJobs = useMemo(
    () => data?.jobs.filter((j) => j.market_hours_stale) ?? [],
    [data]
  );

  const fleetScore = useMemo(() => {
    if (!data) return 0;
    const { healthy, warning, total, failed, stale } = data.summary;
    if (!total) return 0;
    return Math.round(((healthy + warning * 0.5) / total) * 100 - failed * 12 - stale * 8);
  }, [data]);

  if (loading && !data) {
    return (
      <div className="admin-cron-loading">
        <span className="admin-cron-loading-ring" />
        <p>Syncing fleet telemetry…</p>
      </div>
    );
  }

  if (error && !data) {
    return <EmptyDeck title="Cron fleet offline" hint={error} />;
  }

  if (!data) return null;

  return (
    <div className={clsx("admin-cron-dashboard", pulse && "admin-cron-dashboard-pulse")}>
      <TabCommandHero
        kicker="Operations · Fleet"
        title="Cron"
        titleAccent="pulse"
        subtitle={`${data.summary.healthy}/${data.summary.total} jobs online · ${data.logged_runs_total} logged runs · refreshed ${ageSec}s ago`}
        chips={
          <>
            <MetricChip label="DB" value={data.db_configured ? "LINKED" : "DOWN"} tone={data.db_configured ? "bull" : "bear"} />
            <MetricChip label="Secret" value={data.cron_secret_configured ? "ARMED" : "OPEN"} tone={data.cron_secret_configured ? "bull" : "bear"} />
            <MetricChip label="Logged" value={String(data.logged_runs_total)} tone="cyan" />
            <LivePill label={refreshing ? "SYNC" : "LIVE"} active={!refreshing} />
          </>
        }
        actions={
          <ActionButton variant="primary" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? "Syncing…" : "Force sync"}
          </ActionButton>
        }
        rings={
          <>
            <WinRateRing
              value={healthyPct}
              label="Online"
              sub={`${data.summary.healthy} jobs`}
              tone={data.summary.failed > 0 ? "bear" : "bull"}
              size={118}
            />
            <WinRateRing
              value={Math.min(1, data.logged_runs_total / 50)}
              label="Telemetry"
              sub={`${data.logged_runs_total} events`}
              tone="cyan"
              size={118}
            />
            <WinRateRing
              value={data.summary.failed > 0 ? Math.min(1, data.summary.failed / data.summary.total) : 0}
              label="Failed"
              sub={String(data.summary.failed)}
              tone="bear"
              size={118}
            />
            <WinRateRing
              value={data.summary.unknown / Math.max(1, data.summary.total)}
              label="Dark"
              sub={`${data.summary.unknown} idle`}
              tone="violet"
              size={118}
            />
          </>
        }
      />

      {rthStaleJobs.length > 0 && (
        <div className="admin-cron-rth-alert" role="alert">
          <div className="admin-cron-rth-alert-head">
            <span className="admin-cron-rth-alert-dot" aria-hidden />
            <span className="admin-cron-rth-alert-title">
              {rthStaleJobs.length} market-hours cron{rthStaleJobs.length > 1 ? "s" : ""} STALE during RTH — live data is breaking
            </span>
          </div>
          <ul className="admin-cron-rth-alert-list">
            {rthStaleJobs.map((j) => (
              <li key={j.key} className="admin-cron-rth-alert-item">
                <span className="admin-cron-rth-alert-job">{j.name}</span>
                <span className="admin-cron-rth-alert-detail">{j.status_label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.diagnostics_note && (
        <GlassPanel kicker="Diagnostics" title="Fleet note" accent="amber">
          <p className="admin-cron-diagnostics-text">{data.diagnostics_note}</p>
        </GlassPanel>
      )}

      <SectionDeck accent="cyan" className="admin-cron-deck">
        <div className="admin-cron-fleet-bar">
          <div title="Score = (healthy + warning×0.5) / total × 100 − failed×12 − stale×8">
            <HealthMeter
              label={`Fleet health score · ${Math.max(0, Math.min(100, fleetScore))}/100`}
              value={Math.max(0, Math.min(100, fleetScore))}
              tone={fleetScore >= 70 ? "bull" : fleetScore >= 40 ? "amber" : "bear"}
            />
          </div>
          <div className="admin-cron-fleet-breakdown">
            <HorzBar label="Online" value={data.summary.healthy} max={data.summary.total} tone="bull" right={String(data.summary.healthy)} />
            <HorzBar label="Caution" value={data.summary.warning} max={data.summary.total} tone="cyan" right={String(data.summary.warning)} />
            <HorzBar label="Stale" value={data.summary.stale} max={data.summary.total} tone="amber" right={String(data.summary.stale)} />
            <HorzBar label="Dark" value={data.summary.unknown} max={data.summary.total} tone="violet" right={String(data.summary.unknown)} />
          </div>
        </div>

        <div className="admin-cron-job-grid">
          {data.jobs.map((job, i) => (
            <CronJobCard key={job.key} job={job} index={i} onRan={() => load(true)} />
          ))}
        </div>
      </SectionDeck>

      <DeckPanel title="Recent runs · live feed" defaultOpen badge={String(data.recent_events.length)} accent="bull" storageKey="cron-feed">
        <RecentRunsFeed events={data.recent_events} />
      </DeckPanel>

      {error && <p className="admin-error">{error}</p>}
    </div>
  );
}
