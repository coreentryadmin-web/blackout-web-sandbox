"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
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
  railway?:
    | { configured: false }
    | { configured: true; ok: false; error: string }
    | { configured: true; ok: true; deployments: Array<{ status: string; createdAt: string; commitHash: string | null; commitMessage: string | null }> };
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
  report_trail?: Array<{ source: string; at: string; preview: string }>;
};

type Stage = {
  n: number;
  name: string;
  status: "SHIPPED" | "IN PROGRESS" | "NOT YET" | "BLOCKED";
  blurb: string;
};

// Static, hand-kept-in-sync summary of docs/bie/FULL-SYSTEM-AWARENESS.md — the
// roadmap doc is the source of truth; this is a legible dashboard view of it,
// not a second source. Update alongside that doc when a stage's status changes.
const ROADMAP: Stage[] = [
  { n: 1, name: "Repo, docs, API usage, schemas", status: "SHIPPED", blurb: "Knowledge corpus ingested + embedded (Voyage); platform telemetry monitoring is real, not aspirational." },
  { n: 2, name: "Logs, errors, cron/worker health", status: "SHIPPED", blurb: "Backend + frontend error capture, cron health, Postgres pool, Redis internals, data-integrity/data-correctness validators all wired into discovery." },
  { n: 3, name: "Infra access (Railway)", status: "IN PROGRESS", blurb: "Deploy status now wired into this report live (see the Railway chip above) — first automated use, not just manual queries. Deploy/build logs, resource usage, and env-var auditing are still manual-only." },
  { n: 4, name: "Unified per-alert audit trail", status: "SHIPPED", blurb: "alert_audit_log schema, all three write-paths (0DTE, Night Hawk published, Night Hawk rejected — all fixture-tested), and the query surface (Audit trail panel below) are all live. Source-API attribution (source_apis column) is still unpopulated by any write-path — reported honestly as 0% until a future PR threads it through." },
  { n: 5, name: "Outcome-driven calibration for plays", status: "NOT YET", blurb: "Outcome grading exists (0DTE, Night Hawk); nothing yet closes the loop by adjusting scoring logic from it. Explicitly secondary to data integrity per the charter." },
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
              label="Railway deploy"
              value={
                !data?.railway?.configured
                  ? "OFF"
                  : data.railway.ok
                    ? (data.railway.deployments[0]?.status ?? "—")
                    : "DOWN"
              }
              tone={
                data?.railway?.configured &&
                (!data.railway.ok ||
                  data.railway.deployments[0]?.status === "FAILED" ||
                  data.railway.deployments[0]?.status === "CRASHED")
                  ? "amber"
                  : "bull"
              }
            />
            <LivePill label={loading ? "SYNC" : "LIVE"} active={!loading} />
          </>
        }
        actions={
          <ActionButton variant="primary" onClick={() => void load()} disabled={loading}>
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
