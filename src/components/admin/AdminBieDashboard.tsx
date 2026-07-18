"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { fmtPremium } from "@/lib/api";
import {
  ActionButton,
  DataTable,
  DeckPanel,
  GlassPanel,
  LivePill,
  MegaStat,
  MetricChip,
  TabCommandHero,
  WinRateRing,
} from "@/components/admin/AdminUi";

// ---------------------------------------------------------------------------
// The BIE admin tab: live status, open issues (incidents + data-correctness
// flags) with clickable ack/resolve, a roadmap of what's shipped/next, and
// the three self-improvement reports. Everything here reads /api/admin/bie-report
// (already computes all of it on demand) — no new data-fetching duplication.
// ---------------------------------------------------------------------------

type DiscoveryIncident = {
  id: string;
  severity: string;
  category: string;
  title: string;
  detail: string;
  opened_at: string;
};

type CorrectnessFlag = { layer: string; metric: string; detail: string };
type CorrectnessSummary = {
  ran_at: string;
  overall_status: string;
  market_open: boolean;
  flags: CorrectnessFlag[];
  independently_confirmed: number;
  consistency_only: number;
};

type BieReportPayload = {
  available: boolean;
  reason?: string;
  embeddings?: {
    configured: boolean;
    probe: { ok: true; dims: number } | { ok: false; error: string };
    retrieval_probe: Array<{ source: string; kind: string; similarity: number }>;
  };
  knowledge?: {
    total: number;
    embedded: number;
    by_kind: Array<{ kind: string; total: number; embedded: number }>;
    newest_at: string | null;
  } | null;
  db_pool?: { configured: boolean; total: number; idle: number; waiting: number } | null;
  redis?:
    | { configured: false }
    | { configured: true; connected: false; error: string }
    | { configured: true; connected: true; used_memory_mb: number; connected_clients: number; uptime_hours: number; keys: number };
  missed_alerts?: { outage_count: number; windows: Array<{ job_key: string; status: string; status_label: string }> };
  pg_stat_statements?:
    | { configured: false }
    | { configured: true; enabled: false }
    | { configured: true; enabled: true; tracked_statement_count: number };
  self_eval?: { text: string } | null;
  calibration?: { text: string } | null;
  discovery?: { text: string } | null;
  interactions_24h?: {
    total: number;
    routed: number;
    claude: number;
    avg_claims_verified?: number | null;
    avg_claims_total?: number | null;
    avg_latency_router_ms: number | null;
    avg_latency_claude_ms: number | null;
  } | null;
  open_incidents?: DiscoveryIncident[];
  correctness?: CorrectnessSummary | null;
  audit_trail?: {
    recent: Array<{
      id: number;
      alert_type: string;
      ticker: string;
      direction: string | null;
      fired_at: string;
      confidence_score: number | null;
      confidence_label: string | null;
      trigger_reason: string | null;
      outcome: string | null;
    }>;
    counts_by_type: Record<string, number>;
    source_api_attribution_pct: number;
  } | null;
  duplicate_alerts?: Array<{ alert_type: string; source_key: Record<string, unknown>; count: number }>;
  stage5_proposals?: Array<{ kind: string; component: string; file: string; detail: string }>;
  auth_failures?: { total_24h: number; by_mode: Record<string, number>; recent_messages: string[] };
  confluence_outcomes?: Array<{
    bucket: "agree" | "disagree" | "no_echo";
    n: number;
    hit_rate_pct: number | null;
    avg_move_pct: number | null;
    insufficient_sample: boolean;
  }> | null;
  hot_tickers?: Array<{ ticker: string; print_count: number; total_premium: number }>;
  report_trail?: Array<{ source: string; at: string; preview: string }>;
};

type Stage = {
  n: number;
  name: string;
  status: "SHIPPED" | "IN PROGRESS" | "NOT YET" | "BLOCKED";
  blurb: string;
};

// SPX health panel (task #111) — payload shape of /api/admin/spx/health, a
// small dedicated route separate from this component's main
// /api/admin/bie-report fetch (that report is BIE-specific: interactions,
// calibration, discovery — SPX play-engine health doesn't belong there). See
// src/lib/admin-spx-health.ts for the read-only data source and
// src/app/api/admin/spx/health/route.ts for the route.
type SpxHealthPlay = {
  available: boolean;
  phase: "SCANNING" | "WATCHING" | "OPEN";
  action: string;
  direction: "long" | "short" | null;
  grade: string;
  score: number;
  confidence: number;
  gates: { passed: boolean; blocks: string[]; warnings: string[]; entry_mode: string };
  signal_committed: boolean;
  as_of: string;
};

type SpxHealthSignal = {
  id: number;
  action: string;
  bias: string;
  score: number;
  confidence: number;
  headline: string;
  created_at: string;
};

type SpxHealthPayload = {
  generated_at: string;
  play: SpxHealthPlay | null;
  desk: {
    available: boolean;
    price: number | null;
    market_open: boolean;
    age_sec: number | null;
    stale: boolean;
    stale_threshold_sec: number;
  };
  flow_feed_live: boolean;
  recent_signals: SpxHealthSignal[];
  errors: string[];
};

// Thermal health panel (task #138) — payload shape of /api/admin/gex/health, the
// BlackOut Thermal (GEX/heatmap pipeline) analogue of the SPX health panel above: its
// own dedicated read-only route (src/app/api/admin/gex/health/route.ts) and data source
// (src/lib/admin-gex-health.ts) — never the heavier /api/admin/bie-report fetch, and
// there is no admin-spx-dashboard.ts-style full Thermal tool yet for this to piggyback
// on either.
type GexHealthTicker = {
  ticker: string;
  cached: boolean;
  last_compute_at: string | null;
  age_sec: number | null;
  ttl_sec: number;
  stale: boolean;
  spot: number | null;
  events_count: number | null;
};

type GexHealthRegimeEventRow = {
  id: number;
  observed_at: string;
  session_date: string;
  ticker: string;
  event_type: string;
  severity: string;
  message: string;
  level: number | null;
  direction: string | null;
  from_value: number | null;
  to_value: number | null;
  detected_at: string | null;
};

type GexHealthCronJob = {
  key: string;
  name: string;
  status: string;
  status_label: string;
  last_run_at: string | null;
  age_min: number | null;
  runs_24h: { ok: number; failed: number; skipped: number };
};

type GexHealthRecentError = {
  scope: string | null;
  name: string;
  message: string;
  created_at: string;
};

type GexHealthPayload = {
  generated_at: string;
  db_configured: boolean;
  tickers: GexHealthTicker[];
  regime_events: {
    summary: {
      window_hours: number;
      total: number;
      by_ticker: Array<{ ticker: string; count: number }>;
      by_type: Array<{ type: string; count: number }>;
    };
    recent: GexHealthRegimeEventRow[];
  };
  cron: GexHealthCronJob[];
  recent_errors: GexHealthRecentError[];
  errors: string[];
};

// 0DTE Command health panel (task #150) — payload shape of /api/admin/zerodte/health,
// direct analogue of the SPX health panel above, for the SEPARATE multi-ticker
// scanner branded "0DTE Command" in-app (`/grid`'s default tab), not SPX Slayer's
// own engine (task #127's naming disambiguation). See
// src/lib/admin-zerodte-health.ts for the read-only data source and
// src/app/api/admin/zerodte/health/route.ts for the route.
type ZeroDteHealthPayload = {
  generated_at: string;
  session_date: string;
  db_configured: boolean;
  scan: {
    last_scan_at: string | null;
    status: "healthy" | "warning" | "stale" | "failed" | "unknown";
    status_label: string;
    age_min: number | null;
    stale_after_min: number;
  };
  candidates_scanned: number;
  committed_count: number;
  rejected_count: number;
  rejection_rate: number | null;
  rejections_sample_capped: boolean;
  errors: string[];
};

// HELIX health panel (task #134) — payload shape of /api/admin/helix/health, the
// HELIX flow-ingestion-pipeline analogue of the two panels above: cron liveness for
// flow-ingest + market-regime-detector, a read-only cluster-wide live-tape heartbeat
// peek (never triggers a reconnect/poll of its own), and today's committed-vs-
// near-miss anomaly counts (the SAME committed/rejected union pattern 0DTE Command's
// panel uses, applied to flow_anomalies/flow_anomaly_near_misses). See
// src/lib/admin-helix-health.ts for the read-only data source and
// src/app/api/admin/helix/health/route.ts for the route.
type HelixHealthCronJob = {
  key: string;
  name: string;
  status: string;
  status_label: string;
  last_run_at: string | null;
  age_min: number | null;
  runs_24h: { ok: number; failed: number; skipped: number };
};

type HelixHealthTapePeek = {
  heartbeat_present: boolean;
  last_frame_at: string | null;
  age_sec: number | null;
  fresh: boolean;
};

type HelixHealthAnomalyRow = {
  id: number;
  detected_at: string;
  anomaly_type: string;
  ticker: string | null;
  detail: string;
  premium: number | null;
  direction: string | null;
  severity: string | null;
};

type HelixHealthNearMissRow = {
  id: number;
  observed_at: string;
  anomaly_type: string;
  ticker: string | null;
  reason: string;
  metric_value: number;
  threshold: number;
  premium: number | null;
  direction: string | null;
  severity: string | null;
  detail: string;
};

type HelixHealthRecentError = {
  scope: string | null;
  name: string;
  message: string;
  created_at: string;
};

type HelixHealthPayload = {
  generated_at: string;
  session_date: string;
  db_configured: boolean;
  cron: HelixHealthCronJob[];
  tape: HelixHealthTapePeek;
  candidates_scanned: number;
  committed_count: number;
  near_miss_only_count: number;
  near_miss_rate: number | null;
  recent_committed: HelixHealthAnomalyRow[];
  recent_near_misses: HelixHealthNearMissRow[];
  recent_errors: HelixHealthRecentError[];
  errors: string[];
};

// Static, hand-kept-in-sync summary of docs/bie/FULL-SYSTEM-AWARENESS.md — the
// roadmap doc is the source of truth; this is a legible dashboard view of it,
// not a second source. Update alongside that doc when a stage's status changes.
const ROADMAP: Stage[] = [
  { n: 1, name: "Repo, docs, API usage, schemas", status: "SHIPPED", blurb: "Knowledge corpus ingested + embedded (Voyage); platform telemetry monitoring is real, not aspirational." },
  { n: 2, name: "Logs, errors, cron/worker health", status: "SHIPPED", blurb: "Backend + frontend error capture, cron health, Postgres pool, Redis internals, data-integrity/data-correctness validators, missed-alert detection (cron-outage ground truth), and duplicate-alert detection (verifies alert_audit_log's own xmax=0 / unique-index dedup actually holds) all wired into discovery. Fixed a real double-counting bug found in the process: an admin-route catch-all was independently re-capturing every dbQuery failure the dbQuery layer had already recorded, inflating this dashboard's own error count. Every item from the original ask is now shipped." },
  { n: 3, name: "Infra access (ECS)", status: "SHIPPED", blurb: "Postgres slow-query log (pg_stat_statements) is checked, not enabled, per explicit instruction. Clerk auth-failure monitoring: Clerk has no webhook/Backend API for a failed sign-in (confirmed against their docs) — rather than rewrite the sign-in UI, a DOM observer sits alongside the untouched prebuilt <SignIn>/<SignUp> component and reports the error text Clerk already renders on a failed attempt, never a credential. See the \"Auth failures (24h)\" chip above." },
  { n: 4, name: "Unified per-alert audit trail", status: "SHIPPED", blurb: "alert_audit_log schema, all three write-paths (0DTE, Night Hawk published, Night Hawk rejected — all fixture-tested), and the query surface (Audit trail panel below) are all live. Source-API attribution (source_apis column) is still unpopulated by any write-path — reported honestly as 0% until a future PR threads it through." },
  { n: 5, name: "BIE opens PRs autonomously", status: "IN PROGRESS", blurb: "The end-state goal — explicitly NOT started as \"BIE writes code\" yet. Step 1 shipped 2026-07-03, dry-run only: for one narrow, 100% mechanical finding (an exported component with zero references anywhere else in src/), BIE drafts a plain-text proposal in the report below — never a diff, never a git action, never an LLM judgment call. A human decides what (if anything) to do about each one. Going further (real draft PRs, broader/LLM-judged finding types) needs its own explicit go-ahead, not assumed from this." },
  { n: 6, name: "Outcome-driven calibration for plays", status: "NOT YET", blurb: "Outcome grading exists (0DTE, Night Hawk); nothing yet closes the loop by adjusting scoring logic from it. A first measurement step shipped 2026-07-03 (Confluence outcomes panel below) — whether 0DTE Command's graded hit rate differs when it agrees/disagrees with a ticker's prior Night Hawk take — but it is read-only and does not feed back into scoring. Explicitly secondary to data integrity per the charter. (Renumbered from a stale \"Stage 5\" label that collided with the real Stage 5 above — found via the same doc-drift pattern this session kept fixing elsewhere.)" },
];

function fmtEt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stageTone(status: Stage["status"]): "bull" | "cyan" | "amber" | "violet" {
  if (status === "SHIPPED") return "bull";
  if (status === "IN PROGRESS") return "cyan";
  if (status === "BLOCKED") return "amber";
  return "violet";
}

function severityTone(severity: string): "bull" | "bear" | "amber" | "violet" {
  if (severity === "critical") return "bear";
  if (severity === "warning") return "amber";
  return "violet";
}

export function AdminBieDashboard() {
  const [data, setData] = useState<BieReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bie-report", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as BieReportPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // SPX health panel — deliberately a SEPARATE fetch/state/effect from the BIE
  // report above (own loading/error state, own effect on mount) so a failure
  // fetching SPX health can never blank or block the rest of this dashboard,
  // and vice versa. Wired into the SAME "Recompute" button below for a single
  // refresh affordance, but the two requests are otherwise fully independent.
  const [spxHealth, setSpxHealth] = useState<SpxHealthPayload | null>(null);
  const [spxHealthLoading, setSpxHealthLoading] = useState(true);
  const [spxHealthError, setSpxHealthError] = useState<string | null>(null);

  const loadSpxHealth = useCallback(async () => {
    setSpxHealthLoading(true);
    setSpxHealthError(null);
    try {
      const res = await fetch("/api/admin/spx/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSpxHealth((await res.json()) as SpxHealthPayload);
    } catch (e) {
      setSpxHealthError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setSpxHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSpxHealth();
  }, [loadSpxHealth]);

  // Thermal health panel (task #138) — SAME independent fetch/state/effect contract as
  // the SPX health panel above: its own loading/error state and its own effect on
  // mount, so a failure fetching Thermal health can never blank or block the rest of
  // this dashboard (or the SPX health panel), and vice versa. Wired into the SAME
  // "Recompute" button for one refresh affordance.
  const [gexHealth, setGexHealth] = useState<GexHealthPayload | null>(null);
  const [gexHealthLoading, setGexHealthLoading] = useState(true);
  const [gexHealthError, setGexHealthError] = useState<string | null>(null);

  const loadGexHealth = useCallback(async () => {
    setGexHealthLoading(true);
    setGexHealthError(null);
    try {
      const res = await fetch("/api/admin/gex/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGexHealth((await res.json()) as GexHealthPayload);
    } catch (e) {
      setGexHealthError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setGexHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGexHealth();
  }, [loadGexHealth]);

  // 0DTE Command health panel (task #150) — same independence contract as the SPX
  // health fetch above: its own state/effect, so a failure here can never blank or
  // block the rest of this dashboard (or the SPX health panel), and vice versa.
  // Wired into the SAME "Recompute" button below for one refresh affordance.
  const [zeroDteHealth, setZeroDteHealth] = useState<ZeroDteHealthPayload | null>(null);
  const [zeroDteHealthLoading, setZeroDteHealthLoading] = useState(true);
  const [zeroDteHealthError, setZeroDteHealthError] = useState<string | null>(null);

  const loadZeroDteHealth = useCallback(async () => {
    setZeroDteHealthLoading(true);
    setZeroDteHealthError(null);
    try {
      const res = await fetch("/api/admin/zerodte/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setZeroDteHealth((await res.json()) as ZeroDteHealthPayload);
    } catch (e) {
      setZeroDteHealthError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setZeroDteHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadZeroDteHealth();
  }, [loadZeroDteHealth]);

  // HELIX health panel (task #134) — same independence contract as every other
  // health fetch above: its own state/effect, so a failure here can never blank or
  // block the rest of this dashboard (or any other panel), and vice versa. Wired
  // into the SAME "Recompute" button below for one refresh affordance.
  const [helixHealth, setHelixHealth] = useState<HelixHealthPayload | null>(null);
  const [helixHealthLoading, setHelixHealthLoading] = useState(true);
  const [helixHealthError, setHelixHealthError] = useState<string | null>(null);

  const loadHelixHealth = useCallback(async () => {
    setHelixHealthLoading(true);
    setHelixHealthError(null);
    try {
      const res = await fetch("/api/admin/helix/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHelixHealth((await res.json()) as HelixHealthPayload);
    } catch (e) {
      setHelixHealthError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setHelixHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHelixHealth();
  }, [loadHelixHealth]);

  const act = useCallback(
    async (id: string, action: "ack" | "resolve") => {
      setActing(id);
      try {
        const res = await fetch("/api/admin/incidents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        if (res.ok) await load();
      } finally {
        setActing(null);
      }
    },
    [load]
  );

  const inter = data?.interactions_24h;
  const coverage = inter && inter.total > 0 ? Math.round((inter.routed / inter.total) * 1000) / 10 : null;
  const verification =
    inter?.avg_claims_total && inter.avg_claims_total > 0 && inter.avg_claims_verified != null
      ? Math.round((inter.avg_claims_verified / inter.avg_claims_total) * 1000) / 10
      : null;
  const incidents = data?.open_incidents ?? [];
  const correctness = data?.correctness ?? null;
  const openIssueCount = incidents.length + (correctness?.flags.length ?? 0);
  const auditTrail = data?.audit_trail ?? null;
  const duplicateAlerts = data?.duplicate_alerts ?? [];
  const stage5Proposals = data?.stage5_proposals ?? [];
  const confluenceOutcomes = data?.confluence_outcomes ?? null;
  const hotTickers = data?.hot_tickers ?? [];
  const spxPlay = spxHealth?.play ?? null;
  const spxHealthAccent: "bull" | "bear" | "violet" | "cyan" | "amber" = spxHealthError
    ? "amber"
    : spxHealth && (spxHealth.desk.stale || !spxHealth.flow_feed_live)
      ? "amber"
      : spxPlay?.gates.passed
        ? "bull"
        : "cyan";
  const zeroDteHealthAccent: "bull" | "bear" | "violet" | "cyan" | "amber" = zeroDteHealthError
    ? "amber"
    : zeroDteHealth?.scan.status === "failed"
      ? "bear"
      : zeroDteHealth?.scan.status === "stale" || zeroDteHealth?.scan.status === "warning"
        ? "amber"
        : "cyan";

  const gexStaleTickerCount = gexHealth?.tickers.filter((t) => t.stale).length ?? 0;
  const gexCronUnhealthyCount =
    gexHealth?.cron.filter((j) => j.status !== "healthy").length ?? 0;
  const gexHealthAccent: "bull" | "bear" | "violet" | "cyan" | "amber" = gexHealthError
    ? "amber"
    : gexHealth && (gexStaleTickerCount > 0 || gexCronUnhealthyCount > 0)
      ? "amber"
      : "bull";

  const helixCronUnhealthyCount = helixHealth?.cron.filter((j) => j.status !== "healthy").length ?? 0;
  const helixHealthAccent: "bull" | "bear" | "violet" | "cyan" | "amber" = helixHealthError
    ? "amber"
    : helixHealth && helixHealth.cron.some((j) => j.status === "failed" || j.status === "stale")
      ? "bear"
      : helixHealth && (helixCronUnhealthyCount > 0 || !helixHealth.tape.fresh)
        ? "amber"
        : "bull";

  return (
    <div className="admin-bie-dashboard">
      <TabCommandHero
        kicker="Intelligence · Layer 5 self-report"
        title="BIE"
        titleAccent="control room"
        subtitle={
          data?.available === false
            ? (data.reason ?? "unavailable")
            : `${openIssueCount} open issue${openIssueCount === 1 ? "" : "s"} · ${coverage != null ? `${coverage}% router coverage` : "coverage —"} · recomputed live, not the cached daily tick`
        }
        chips={
          <>
            <MetricChip
              label="Embeddings"
              value={data?.embeddings?.probe.ok ? `LIVE · ${data.embeddings.probe.dims}d` : data?.embeddings ? "DOWN" : "—"}
              tone={data?.embeddings?.probe.ok ? "bull" : "amber"}
            />
            <MetricChip
              label="DB pool"
              value={data?.db_pool ? `${data.db_pool.idle}/${data.db_pool.total} idle` : "—"}
              tone={data?.db_pool && data.db_pool.waiting > 0 ? "amber" : "bull"}
            />
            <MetricChip
              label="Redis"
              value={data?.redis?.configured ? (data.redis.connected ? "LIVE" : "DOWN") : "OFF"}
              tone={data?.redis?.configured && !data.redis.connected ? "amber" : "bull"}
            />
            <MetricChip
              label="Missed alerts"
              value={data?.missed_alerts ? String(data.missed_alerts.outage_count) : "—"}
              tone={data?.missed_alerts && data.missed_alerts.outage_count > 0 ? "amber" : "bull"}
            />
            <MetricChip
              label="Auth failures (24h)"
              value={data?.auth_failures ? String(data.auth_failures.total_24h) : "—"}
              tone="bull"
            />
            <LivePill label={loading ? "SYNC" : "LIVE"} active={!loading} />
          </>
        }
        actions={
          <ActionButton
            variant="primary"
            onClick={() => {
              void load();
              void loadSpxHealth();
              void loadGexHealth();
              void loadZeroDteHealth();
              void loadHelixHealth();
            }}
            disabled={loading}
          >
            {loading ? "Computing…" : "Recompute"}
          </ActionButton>
        }
        rings={
          <>
            <WinRateRing value={coverage != null ? coverage / 100 : 0} label="Router" sub={inter ? `${inter.routed}/${inter.total}` : "—"} tone="cyan" size={118} />
            <WinRateRing value={verification != null ? verification / 100 : 0} label="Verified" sub={verification != null ? `${verification}%` : "—"} tone="bull" size={118} />
            <WinRateRing value={openIssueCount > 0 ? Math.min(1, openIssueCount / 10) : 0} label="Open issues" sub={String(openIssueCount)} tone={openIssueCount > 0 ? "bear" : "bull"} size={118} />
          </>
        }
      />

      {error && (
        <GlassPanel accent="bear" title="Report failed">
          <p className="admin-bie-error-text">{error}</p>
        </GlassPanel>
      )}

      <div className="admin-bie-stat-row">
        <MegaStat label="Router coverage 24h" value={coverage != null ? `${coverage}%` : "—"} sub={inter ? `${inter.routed}/${inter.total} turns` : undefined} tone="cyan" bar={coverage ?? undefined} />
        <MegaStat label="Claim verification" value={verification != null ? `${verification}%` : "—"} tone="bull" bar={verification ?? undefined} />
        <MegaStat label="Open issues" value={String(openIssueCount)} sub={`${incidents.length} incident${incidents.length === 1 ? "" : "s"} · ${correctness?.flags.length ?? 0} correctness flag${(correctness?.flags.length ?? 0) === 1 ? "" : "s"}`} tone={openIssueCount > 0 ? "bear" : "bull"} />
        <MegaStat label="Answer latency" value={inter?.avg_latency_router_ms != null ? `${Math.round(inter.avg_latency_router_ms)}ms` : "—"} sub={inter?.avg_latency_claude_ms != null ? `vs ${Math.round(inter.avg_latency_claude_ms)}ms Claude` : undefined} tone="violet" />
      </div>

      {/* Open issues — already-confirmed by the validation layer (data-integrity
          incidents, data-correctness flags), not a BIE guess. Clickable: ack/resolve
          incidents right here instead of needing a separate admin surface. */}
      <GlassPanel kicker="Validated by the data layer, not BIE" title={`Open issues (${openIssueCount})`} accent={openIssueCount > 0 ? "bear" : "bull"}>
        {openIssueCount === 0 ? (
          <p className="admin-bie-empty-text">Nothing open right now.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Status</th>
                <th>Source</th>
                <th>What</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc) => (
                <tr key={inc.id}>
                  <td>
                    <span className={clsx("admin-outcome-badge", `admin-outcome-badge-${severityTone(inc.severity)}`)}>
                      {inc.severity}
                    </span>
                  </td>
                  <td>{inc.category}</td>
                  <td>
                    <p className="admin-bie-issue-title">{inc.title}</p>
                    <p className="admin-bie-issue-detail">{inc.detail}</p>
                    <p className="admin-bie-issue-meta">opened {fmtEt(inc.opened_at)} ET</p>
                  </td>
                  <td>
                    <div className="admin-bie-issue-actions">
                      <ActionButton onClick={() => void act(inc.id, "ack")} disabled={acting === inc.id}>
                        Ack
                      </ActionButton>
                      <ActionButton variant="primary" onClick={() => void act(inc.id, "resolve")} disabled={acting === inc.id}>
                        Resolve
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))}
              {correctness?.flags.map((f, i) => (
                <tr key={`flag-${i}`}>
                  <td>
                    <span className="admin-outcome-badge admin-outcome-badge-bear">flag</span>
                  </td>
                  <td>{f.layer}/{f.metric}</td>
                  <td>
                    <p className="admin-bie-issue-detail">{f.detail}</p>
                    <p className="admin-bie-issue-meta">data-correctness · {fmtEt(correctness.ran_at)} ET</p>
                  </td>
                  <td className="admin-bie-issue-meta">fix in code, not here</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        {correctness && (
          <p className="admin-bie-coverage-note">
            Last data-correctness run: {correctness.independently_confirmed} independently confirmed,{" "}
            {correctness.consistency_only} consistency-only (honest coverage gap, not a guarantee).
          </p>
        )}
      </GlassPanel>

      {/* Stage 4 query surface — the unified alert_audit_log view across all three
          write-paths (0DTE, Night Hawk published, Night Hawk rejected). Reads only
          what those write-paths already recorded; no new decision logic here. */}
      <GlassPanel kicker="Every alert, one schema" title="Audit trail" accent="cyan">
        {!auditTrail || auditTrail.recent.length === 0 ? (
          <p className="admin-bie-empty-text">No audit-trail rows yet.</p>
        ) : (
          <>
            <DataTable>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Ticker</th>
                  <th>Dir</th>
                  <th>Confidence</th>
                  <th>Trigger</th>
                  <th>Outcome</th>
                  <th>Fired</th>
                </tr>
              </thead>
              <tbody>
                {auditTrail.recent.map((r) => (
                  <tr key={r.id}>
                    <td>{r.alert_type}</td>
                    <td>{r.ticker}</td>
                    <td>{r.direction ?? "—"}</td>
                    <td>
                      {r.confidence_score != null ? Math.round(r.confidence_score) : "—"}
                      {r.confidence_label ? ` (${r.confidence_label})` : ""}
                    </td>
                    <td className="admin-bie-issue-detail">{r.trigger_reason ?? "—"}</td>
                    <td>{r.outcome ?? "pending"}</td>
                    <td className="admin-bie-issue-meta">{fmtEt(r.fired_at)} ET</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <p className="admin-bie-coverage-note">
              {Object.entries(auditTrail.counts_by_type)
                .map(([type, n]) => `${n} ${type}`)
                .join(" · ")}{" "}
              total · source-API attribution: {auditTrail.source_api_attribution_pct}%{" "}
              (unpopulated by any write-path yet — honest 0, not a guess).
            </p>
            <p className={clsx("admin-bie-coverage-note", duplicateAlerts.length > 0 && "admin-bie-error-text")}>
              Duplicate check: {duplicateAlerts.length === 0
                ? "0 duplicate rows found — the xmax=0 / unique-index dedup on all three write-paths is holding."
                : `${duplicateAlerts.length} duplicate group(s) found — a dedup write-path has a bug: ${duplicateAlerts
                    .slice(0, 3)
                    .map((d) => `${d.alert_type} ×${d.count}`)
                    .join(", ")}.`}
            </p>
          </>
        )}
      </GlassPanel>

      {/* SPX health (task #111) — read-only glance at the live 0DTE Command
          engine: current phase/action, gate pass/fail with the actual block
          reasons (not just a boolean), score/grade, desk-feed freshness, the
          flow-feed heartbeat, and the last few committed signal-log entries.
          Own fetch/state (see loadSpxHealth above), so a failure here shows
          "—" in this panel only and never breaks the rest of the dashboard —
          same resilience contract as every other panel on this page. Reuses
          the SAME read-only evaluation path /api/market/spx/play (member
          route) and /api/admin/spx/dashboard's live=1 toggle already call;
          see src/lib/admin-spx-health.ts's module doc for the read-only
          proof (mutate:false skips every position/Discord write). Purely
          observability — this panel never writes to, mutates, or triggers
          any play-engine action. */}
      <GlassPanel kicker="SPX Slayer · read-only, never mutates the play engine" title="SPX health" accent={spxHealthAccent}>
        {spxHealthError && (
          <p className="admin-bie-error-text">SPX health fetch failed: {spxHealthError}</p>
        )}
        <div className="admin-metric-chip-row">
          <MetricChip label="Phase" value={spxPlay?.phase ?? "—"} tone={spxPlay ? "cyan" : "neutral"} />
          <MetricChip
            label="Action"
            value={spxPlay?.action ?? "—"}
            tone={spxPlay?.action === "BUY" || spxPlay?.action === "SELL" ? "bull" : spxPlay ? "cyan" : "neutral"}
          />
          <MetricChip
            label="Grade / Score"
            value={spxPlay ? `${spxPlay.grade} · ${Math.round(spxPlay.score)}` : "—"}
            tone="violet"
          />
          <MetricChip
            label="Gates"
            value={
              !spxPlay
                ? "—"
                : spxPlay.gates.passed
                  ? "PASS"
                  : `${spxPlay.gates.blocks.length} block${spxPlay.gates.blocks.length === 1 ? "" : "s"}`
            }
            tone={!spxPlay ? "neutral" : spxPlay.gates.passed ? "bull" : "amber"}
          />
          <MetricChip
            label="Desk feed"
            value={!spxHealth ? "—" : !spxHealth.desk.available ? "DOWN" : spxHealth.desk.stale ? "STALE" : "FRESH"}
            tone={!spxHealth ? "neutral" : !spxHealth.desk.available || spxHealth.desk.stale ? "amber" : "bull"}
          />
          <MetricChip
            label="Flow feed"
            value={!spxHealth ? "—" : spxHealth.flow_feed_live ? "LIVE" : "DOWN"}
            tone={!spxHealth ? "neutral" : spxHealth.flow_feed_live ? "bull" : "amber"}
          />
        </div>

        {spxPlay && !spxPlay.gates.passed && spxPlay.gates.blocks.length > 0 && (
          <>
            <p className="admin-bie-coverage-note">Blocked by:</p>
            {spxPlay.gates.blocks.map((b, i) => (
              <p key={i} className="admin-bie-issue-detail">
                – {b}
              </p>
            ))}
          </>
        )}

        <p className="admin-bie-coverage-note">
          {spxHealth
            ? `Desk age ${spxHealth.desk.age_sec != null ? `${Math.round(spxHealth.desk.age_sec)}s` : "—"} (stale past ${spxHealth.desk.stale_threshold_sec}s) · as of ${fmtEt(spxPlay?.as_of ?? spxHealth.generated_at)} ET`
            : spxHealthLoading
              ? "Loading…"
              : "—"}
        </p>

        <p className="admin-bie-coverage-note">Recent signal log</p>
        {!spxHealth || spxHealth.recent_signals.length === 0 ? (
          <p className="admin-bie-empty-text">No committed BUY/SELL/TRIM signals logged yet today.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Action</th>
                <th>Bias</th>
                <th>Score</th>
                <th>Headline</th>
                <th>Fired</th>
              </tr>
            </thead>
            <tbody>
              {spxHealth.recent_signals.map((s) => (
                <tr key={s.id}>
                  <td>{s.action}</td>
                  <td>{s.bias}</td>
                  <td>
                    {Math.round(s.score)} ({Math.round(s.confidence)}%)
                  </td>
                  <td className="admin-bie-issue-detail">{s.headline}</td>
                  <td className="admin-bie-issue-meta">{fmtEt(s.created_at)} ET</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </GlassPanel>

      {/* Thermal health (task #138) — read-only glance at the BlackOut Thermal
          (GEX/heatmap) pipeline: per-preset-ticker matrix cache freshness (is the
          shared gex-heatmap:{ticker} cache actually warm right now — peekGexHeatmapCache
          never triggers a build, so this panel adds zero upstream cost just from being
          viewed), the durable regime-transition log (task #136, gex_regime_events —
          flip/wall/regime crossings across every watched ticker, not just gex-alerts'
          3-ticker push watchlist), and the THREE Thermal-owned crons (heatmap-warm,
          gex-eod-snapshot, gex-alerts) filtered from the SAME generic cron-health
          snapshot the Crons admin tab reads (admin-cron-health.ts) — never re-derived
          here. Own fetch/state (see loadGexHealth above), same resilience contract as
          every other panel on this page — a failure here shows "—"/"failed to load"
          and never breaks the rest of the dashboard. */}
      <GlassPanel kicker="BlackOut Thermal · read-only cache peek, never triggers a build" title="Thermal health" accent={gexHealthAccent}>
        {gexHealthError && (
          <p className="admin-bie-error-text">Thermal health fetch failed: {gexHealthError}</p>
        )}
        <div className="admin-metric-chip-row">
          <MetricChip
            label="Matrix cache"
            value={
              gexHealth
                ? `${gexHealth.tickers.length - gexStaleTickerCount}/${gexHealth.tickers.length} warm`
                : "—"
            }
            tone={!gexHealth ? "neutral" : gexStaleTickerCount > 0 ? "amber" : "bull"}
          />
          <MetricChip
            label="Regime events (24h)"
            value={gexHealth ? String(gexHealth.regime_events.summary.total) : "—"}
            tone={gexHealth && !gexHealth.db_configured ? "neutral" : "violet"}
          />
          {gexHealth?.cron.map((j) => (
            <MetricChip
              key={j.key}
              label={j.name}
              value={j.status_label}
              tone={
                j.status === "healthy"
                  ? "bull"
                  : j.status === "failed" || j.status === "stale"
                    ? "bear"
                    : "amber"
              }
            />
          ))}
        </div>

        <p className="admin-bie-coverage-note">
          {gexHealth ? `As of ${fmtEt(gexHealth.generated_at)} ET` : gexHealthLoading ? "Loading…" : "—"}
        </p>

        {gexHealth && !gexHealth.db_configured && (
          <p className="admin-bie-coverage-note">
            DB not configured — regime-transition history (gex_regime_events) is
            unavailable; the cache/cron legs above are unaffected.
          </p>
        )}

        <p className="admin-bie-coverage-note">Per-ticker matrix cache</p>
        {!gexHealth || gexHealth.tickers.length === 0 ? (
          <p className="admin-bie-empty-text">No preset tickers to report.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Cache</th>
                <th>Age</th>
                <th>Spot</th>
                <th>Last-sample events</th>
              </tr>
            </thead>
            <tbody>
              {gexHealth.tickers.map((t) => (
                <tr key={t.ticker}>
                  <td className="admin-td-strong">{t.ticker}</td>
                  <td>
                    <span
                      className={clsx(
                        "admin-outcome-badge",
                        t.cached && !t.stale ? "admin-outcome-badge-bull" : "admin-outcome-badge-amber"
                      )}
                    >
                      {!t.cached ? "cold" : t.stale ? "stale" : "warm"}
                    </span>
                  </td>
                  <td>{t.age_sec != null ? `${t.age_sec}s` : "—"}</td>
                  <td>{t.spot ?? "—"}</td>
                  <td>{t.events_count ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        <p className="admin-bie-coverage-note">Recent regime transitions (gex_regime_events)</p>
        {!gexHealth || gexHealth.regime_events.recent.length === 0 ? (
          <p className="admin-bie-empty-text">
            {gexHealth && !gexHealth.db_configured
              ? "DB not configured — history unavailable."
              : "No flip/wall/regime crossings logged yet."}
          </p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Type</th>
                <th>Direction</th>
                <th>Message</th>
                <th>Detected</th>
              </tr>
            </thead>
            <tbody>
              {gexHealth.regime_events.recent.map((r) => (
                <tr key={r.id}>
                  <td className="admin-td-strong">{r.ticker}</td>
                  <td>{r.event_type}</td>
                  <td>{r.direction ?? "—"}</td>
                  <td className="admin-bie-issue-detail">{r.message}</td>
                  <td className="admin-bie-issue-meta">{fmtEt(r.detected_at ?? r.observed_at)} ET</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {gexHealth && gexHealth.recent_errors.length > 0 && (
          <>
            <p className="admin-bie-coverage-note admin-bie-error-text">
              Recent GEX-scoped errors (best-effort filter over the shared error_events sink)
            </p>
            {gexHealth.recent_errors.map((e, i) => (
              <p key={i} className="admin-bie-issue-detail">
                – [{e.scope ?? "—"}] {e.message} ({fmtEt(e.created_at)} ET)
              </p>
            ))}
          </>
        )}
      </GlassPanel>

      {/* 0DTE Command health (task #150) — read-only glance at the SEPARATE
          multi-ticker scanner branded "0DTE Command" in-app (/grid's default tab,
          NOT SPX Slayer's own engine above — see task #127's naming
          disambiguation): last-scan-time, candidates-scanned, and rejection rate.
          Own fetch/state (see loadZeroDteHealth above), so a failure here shows
          "—" in this panel only. All 3 numbers are read from data already
          persisted by the existing scan pipeline (zerodte_setup_log,
          zerodte_scan_rejections) and the existing grid-warm cron's run history
          (buildCronHealthSnapshot) — see src/lib/admin-zerodte-health.ts's module
          doc for exactly where each figure comes from and why "candidates
          scanned"/"rejection rate" are today-cumulative, not last-cycle, numbers. */}
      <GlassPanel
        kicker="0DTE Command · read-only, sourced entirely from already-persisted data"
        title="0DTE Command health"
        accent={zeroDteHealthAccent}
      >
        {zeroDteHealthError && (
          <p className="admin-bie-error-text">0DTE Command health fetch failed: {zeroDteHealthError}</p>
        )}
        <div className="admin-metric-chip-row">
          <MetricChip
            label="Last scan"
            value={zeroDteHealth ? fmtEt(zeroDteHealth.scan.last_scan_at) : "—"}
            tone={!zeroDteHealth ? "neutral" : zeroDteHealth.scan.status === "healthy" ? "bull" : "amber"}
          />
          <MetricChip
            label="Scan cron"
            value={zeroDteHealth?.scan.status ?? "—"}
            tone={
              !zeroDteHealth
                ? "neutral"
                : zeroDteHealth.scan.status === "healthy"
                  ? "bull"
                  : zeroDteHealth.scan.status === "failed"
                    ? "bear"
                    : "amber"
            }
          />
          <MetricChip
            label="Candidates scanned"
            value={zeroDteHealth ? `${zeroDteHealth.candidates_scanned} (${zeroDteHealth.session_date})` : "—"}
            tone="cyan"
          />
          <MetricChip
            label="Rejection rate"
            value={
              !zeroDteHealth || zeroDteHealth.rejection_rate == null
                ? "—"
                : `${Math.round(zeroDteHealth.rejection_rate * 100)}% (${zeroDteHealth.rejected_count}/${zeroDteHealth.candidates_scanned})`
            }
            tone={
              !zeroDteHealth || zeroDteHealth.rejection_rate == null
                ? "neutral"
                : zeroDteHealth.rejection_rate > 0.8
                  ? "amber"
                  : "violet"
            }
          />
        </div>

        <p className="admin-bie-coverage-note">
          {zeroDteHealth
            ? `${zeroDteHealth.scan.status_label}${zeroDteHealth.scan.age_min != null ? ` (${zeroDteHealth.scan.age_min}m ago)` : ""} · stale past ${zeroDteHealth.scan.stale_after_min}m — the grid-warm cron that runs the scan pipeline (no dedicated 0DTE cron key exists), NOT a per-scan-cycle timestamp`
            : zeroDteHealthLoading
              ? "Loading…"
              : "—"}
        </p>
        {zeroDteHealth?.rejections_sample_capped && (
          <p className="admin-bie-coverage-note">
            Rejection sample may be truncated for a very high-volume session — candidates_scanned/rejection_rate could be a floor, not exact.
          </p>
        )}
        {zeroDteHealth && !zeroDteHealth.db_configured && (
          <p className="admin-warn">DATABASE_URL not set — candidates-scanned/rejection-rate will read as 0.</p>
        )}
      </GlassPanel>

      {/* HELIX health (task #134) — read-only glance at HELIX's flow-ingestion
          pipeline: cron liveness for the two crons that make up the pipeline
          (flow-ingest, the raw UW flow tape writer; market-regime-detector, which
          derives flow_regime and writes flow_anomalies/flow_anomaly_near_misses
          from that tape), a cluster-wide live-tape heartbeat PEEK (never triggers
          a reconnect/poll of its own — see peekFlowLivenessHeartbeat's doc), and
          today's committed-vs-near-miss anomaly counts — the SAME committed/
          rejected union pattern 0DTE Command's panel above uses, applied to
          flow_anomalies (committed) / flow_anomaly_near_misses (task #131, the
          rejected half). Own fetch/state (see loadHelixHealth above), same
          resilience contract as every other panel on this page. */}
      <GlassPanel
        kicker="HELIX · read-only heartbeat peek, never triggers a reconnect/poll"
        title="HELIX health"
        accent={helixHealthAccent}
      >
        {helixHealthError && (
          <p className="admin-bie-error-text">HELIX health fetch failed: {helixHealthError}</p>
        )}
        <div className="admin-metric-chip-row">
          <MetricChip
            label="Live tape heartbeat"
            value={
              !helixHealth
                ? "—"
                : !helixHealth.tape.heartbeat_present
                  ? "cold"
                  : helixHealth.tape.fresh
                    ? "fresh"
                    : `stale (${helixHealth.tape.age_sec}s)`
            }
            tone={
              !helixHealth ? "neutral" : helixHealth.tape.fresh ? "bull" : "amber"
            }
          />
          {helixHealth?.cron.map((j) => (
            <MetricChip
              key={j.key}
              label={j.name}
              value={j.status_label}
              tone={
                j.status === "healthy"
                  ? "bull"
                  : j.status === "failed" || j.status === "stale"
                    ? "bear"
                    : "amber"
              }
            />
          ))}
          <MetricChip
            label="Candidates scanned"
            value={helixHealth ? `${helixHealth.candidates_scanned} (${helixHealth.session_date})` : "—"}
            tone="cyan"
          />
          <MetricChip
            label="Near-miss rate"
            value={
              !helixHealth || helixHealth.near_miss_rate == null
                ? "—"
                : `${Math.round(helixHealth.near_miss_rate * 100)}% (${helixHealth.near_miss_only_count}/${helixHealth.candidates_scanned})`
            }
            tone={
              !helixHealth || helixHealth.near_miss_rate == null
                ? "neutral"
                : helixHealth.near_miss_rate > 0.8
                  ? "amber"
                  : "violet"
            }
          />
        </div>

        <p className="admin-bie-coverage-note">
          {helixHealth
            ? `As of ${fmtEt(helixHealth.generated_at)} ET · heartbeat ${helixHealth.tape.last_frame_at ? `last frame ${fmtEt(helixHealth.tape.last_frame_at)} ET` : "never observed this session"}`
            : helixHealthLoading
              ? "Loading…"
              : "—"}
        </p>

        {helixHealth && !helixHealth.db_configured && (
          <p className="admin-warn">
            DATABASE_URL not set — candidates-scanned/near-miss-rate/anomaly tables below will read as 0/empty.
          </p>
        )}

        <p className="admin-bie-coverage-note">Committed anomalies today (flow_anomalies)</p>
        {!helixHealth || helixHealth.recent_committed.length === 0 ? (
          <p className="admin-bie-empty-text">No committed HELIX anomalies logged yet today.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Type</th>
                <th>Direction</th>
                <th>Premium</th>
                <th>Detail</th>
                <th>Detected</th>
              </tr>
            </thead>
            <tbody>
              {helixHealth.recent_committed.map((r) => (
                <tr key={r.id}>
                  <td className="admin-td-strong">{r.ticker ?? "—"}</td>
                  <td>{r.anomaly_type}</td>
                  <td>{r.direction ?? "—"}</td>
                  <td>{fmtPremium(r.premium)}</td>
                  <td className="admin-bie-issue-detail">{r.detail}</td>
                  <td className="admin-bie-issue-meta">{fmtEt(r.detected_at)} ET</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        <p className="admin-bie-coverage-note">Near-misses today (flow_anomaly_near_misses, task #131)</p>
        {!helixHealth || helixHealth.recent_near_misses.length === 0 ? (
          <p className="admin-bie-empty-text">
            {helixHealth && !helixHealth.db_configured
              ? "DB not configured — near-miss history unavailable."
              : "No near-misses logged yet today."}
          </p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Type</th>
                <th>Reason</th>
                <th>Direction</th>
                <th>Detail</th>
                <th>Observed</th>
              </tr>
            </thead>
            <tbody>
              {helixHealth.recent_near_misses.map((r) => (
                <tr key={r.id}>
                  <td className="admin-td-strong">{r.ticker ?? "—"}</td>
                  <td>{r.anomaly_type}</td>
                  <td>{r.reason}</td>
                  <td>{r.direction ?? "—"}</td>
                  <td className="admin-bie-issue-detail">{r.detail}</td>
                  <td className="admin-bie-issue-meta">{fmtEt(r.observed_at)} ET</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {helixHealth && helixHealth.recent_errors.length > 0 && (
          <>
            <p className="admin-bie-coverage-note admin-bie-error-text">
              Recent HELIX-scoped errors (best-effort filter over the shared error_events sink)
            </p>
            {helixHealth.recent_errors.map((e, i) => (
              <p key={i} className="admin-bie-issue-detail">
                – [{e.scope ?? "—"}] {e.message} ({fmtEt(e.created_at)} ET)
              </p>
            ))}
          </>
        )}
      </GlassPanel>

      {/* Stage 6 precursor — does the Night Hawk echo shown on the 0DTE board
          (ecosystem-context.ts's 2nd consumer) actually correlate with anything?
          Pure measurement: never feeds back into live scoring. A small/insufficient
          sample is reported honestly, not hidden. */}
      <GlassPanel kicker="Does the ecosystem link mean anything" title="Confluence outcomes" accent="violet">
        {!confluenceOutcomes || confluenceOutcomes.every((s) => s.n === 0) ? (
          <p className="admin-bie-empty-text">No graded 0DTE history in the lookback window yet.</p>
        ) : (
          <>
            <DataTable>
              <thead>
                <tr>
                  <th>vs. Night Hawk</th>
                  <th>N</th>
                  <th>Hit rate</th>
                  <th>Avg move</th>
                </tr>
              </thead>
              <tbody>
                {confluenceOutcomes.map((s) => (
                  <tr key={s.bucket}>
                    <td>
                      {s.bucket === "agree" ? "Agrees" : s.bucket === "disagree" ? "Disagrees" : "No prior take"}
                    </td>
                    <td>
                      {s.n}
                      {s.insufficient_sample && s.n > 0 ? " (thin)" : ""}
                    </td>
                    <td>{s.hit_rate_pct != null ? `${s.hit_rate_pct}%` : "—"}</td>
                    <td>{s.avg_move_pct != null ? `${s.avg_move_pct}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <p className="admin-bie-coverage-note">
              60-day lookback, graded 0DTE Command flags only. &quot;Agrees&quot;/&quot;Disagrees&quot; compare
              direction against the ticker&apos;s most recent prior Night Hawk take. &quot;(thin)&quot; means
              under 10 samples — a hit rate at that size is noise, not signal.
            </p>
          </>
        )}
      </GlassPanel>

      {/* Leaderboard complement to ecosystem-context's per-ticker recent_flow:
          that answers "how hot is this one name," this answers "which names are
          hot right now." Read-only flow_alerts aggregate, index/ETF/leveraged-ETP
          names excluded so SPY/QQQ don't just occupy every slot every day. */}
      <GlassPanel kicker="Live flow_alerts pulse" title="Hot tickers" accent="violet">
        {hotTickers.length === 0 ? (
          <p className="admin-bie-empty-text">No single-name flow in the last 6h.</p>
        ) : (
          <div className="admin-metric-chip-row">
            {hotTickers.map((t) => (
              <MetricChip
                key={t.ticker}
                label={t.ticker}
                value={`${fmtPremium(t.total_premium)} · ${t.print_count}×`}
                tone="violet"
              />
            ))}
          </div>
        )}
      </GlassPanel>

      {/* Stage 3 infra probes — Postgres pg_stat_statements presence check
          (never enables it). Read-only, fail-open (a probe failure shows
          as "—", never breaks the rest of this panel). */}
      <GlassPanel kicker="Stage 3 — infra access" title="Infra" accent="violet">
        <p className="admin-bie-coverage-note">
          pg_stat_statements:{" "}
          {!data?.pg_stat_statements?.configured
            ? "DB not configured"
            : data.pg_stat_statements.enabled
              ? `enabled (${data.pg_stat_statements.tracked_statement_count} tracked statements)`
              : "not enabled (checked, not attempted — server-level config change needs explicit go-ahead)"}
        </p>
      </GlassPanel>

      {/* Stage 5, step 1 — DRY-RUN proposals only. BIE never writes a file, never
          runs git, never opens a PR here; this only reads src/ (read-only) and
          reports a text finding a human decides what to do with. */}
      <GlassPanel kicker="Stage 5, step 1 — dry-run only, never touches git" title="Proposals" accent="cyan">
        {stage5Proposals.length === 0 ? (
          <p className="admin-bie-empty-text">No orphaned-component candidates found on this scan.</p>
        ) : (
          <>
            <DataTable>
              <thead>
                <tr>
                  <th>Component</th>
                  <th>File</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {stage5Proposals.slice(0, 20).map((p, i) => (
                  <tr key={`${p.file}-${p.component}-${i}`}>
                    <td>{p.component}</td>
                    <td className="admin-bie-issue-meta">{p.file}</td>
                    <td className="admin-bie-issue-detail">{p.detail}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <p className="admin-bie-coverage-note">
              {stage5Proposals.length} candidate{stage5Proposals.length === 1 ? "" : "s"} found
              {stage5Proposals.length > 20 ? ` (showing first 20)` : ""} — each is a plain-text
              flag, not a proposed deletion. BIE cannot tell dead code from an unfinished
              feature without design intent, so every one of these is a human decision.
            </p>
          </>
        )}
      </GlassPanel>

      {/* Roadmap — legible view of docs/bie/FULL-SYSTEM-AWARENESS.md's stage table. */}
      <GlassPanel kicker="Where we are, what's next" title="Roadmap" accent="violet">
        {ROADMAP.map((s) => (
          <DeckPanel
            key={s.n}
            title={`Stage ${s.n} — ${s.name}`}
            badge={s.status}
            accent={stageTone(s.status)}
            storageKey={`bie-roadmap-${s.n}`}
          >
            <p className="admin-bie-roadmap-blurb">{s.blurb}</p>
          </DeckPanel>
        ))}
      </GlassPanel>

      {/* The three self-improvement reports — full detail, collapsed by default so
          the tab reads as a dashboard first, a document second. */}
      <GlassPanel kicker="Layer 5 reports" title="Self-improvement" accent="cyan">
        <DeckPanel title="Daily self-evaluation" accent="cyan" storageKey="bie-report-self-eval">
          <pre className="admin-bie-report-text">{data?.self_eval?.text ?? "—"}</pre>
        </DeckPanel>
        <DeckPanel title="Gate calibration · 14 sessions" accent="cyan" storageKey="bie-report-calibration">
          <pre className="admin-bie-report-text">{data?.calibration?.text ?? "—"}</pre>
        </DeckPanel>
        <DeckPanel title="Platform discovery" accent="cyan" storageKey="bie-report-discovery">
          <pre className="admin-bie-report-text">{data?.discovery?.text ?? "—"}</pre>
        </DeckPanel>
      </GlassPanel>

      <p className="admin-bie-footer-note">
        Report-first by design: calibration recommendations cite their evidence and a human ships the
        change — the engine never silently retunes its own gates.
      </p>
    </div>
  );
}
