"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import {
  GlassPanel,
  LivePill,
  MegaStat,
  MetricChip,
  TabCommandHero,
} from "@/components/admin/AdminUi";
import type { AdminIncidentRow } from "@/lib/admin-incidents";
import type { AuditLogEntry } from "@/app/api/admin/audit-log/route";
import type { AdminHealthPayload } from "@/lib/admin-health";

// ─── Timing & constants ───────────────────────────────────────────────────────
const REFRESH_MS = 20_000; // incidents + health
const AUDIT_MS   = 30_000; // audit trail (slower — less volatile)

// ─── Utility helpers ──────────────────────────────────────────────────────────
function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function fmtAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Action icon + color map ──────────────────────────────────────────────────
const ACTION_META: Record<string, { icon: string; color: string }> = {
  api_probe_providers: { icon: "⬡", color: "text-cyan-400"   },
  api_event_view:      { icon: "◉", color: "text-blue-400"   },
  api_rescan:          { icon: "↺", color: "text-sky-400"    },
  spx_live_engine:     { icon: "◎", color: "text-orange-400" },
  incident_ack:        { icon: "✓", color: "text-amber-400"  },
  incident_resolve:    { icon: "◆", color: "text-emerald-400"},
};

function actionMeta(action: string) {
  for (const [key, val] of Object.entries(ACTION_META)) {
    if (action.startsWith(key)) return val;
  }
  return { icon: "·", color: "text-cyan-400" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityPip({ severity }: { severity: string }) {
  const isCrit = severity === "critical";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 font-mono text-[10px] font-black px-2 py-0.5 rounded-full border tracking-widest select-none",
        isCrit
          ? "text-red-400 border-red-500/50 bg-red-950/40"
          : "text-amber-400 border-amber-500/50 bg-amber-950/40"
      )}
    >
      {isCrit ? "● CRITICAL" : "◆ WARNING"}
    </span>
  );
}

function StatusBadge({ status }: { status: AdminIncidentRow["status"] }) {
  return (
    <span
      className={clsx(
        "font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border tracking-widest",
        status === "open"
          ? "text-red-400 border-red-700/40 bg-red-950/20"
          : "text-blue-400 border-blue-700/40 bg-blue-950/20"
      )}
    >
      {status.toUpperCase()}
    </span>
  );
}

function IncidentRow({
  incident,
  onRefresh,
}: {
  incident: AdminIncidentRow;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState<"ack" | "resolve" | null>(null);
  const isCrit = incident.severity === "critical";

  async function act(action: "ack" | "resolve") {
    setLoading(action);
    try {
      await fetch("/api/admin/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: incident.id, action }),
      });
      onRefresh();
    } finally {
      setLoading(null);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{ type: "spring", damping: 22, stiffness: 300 }}
      className={clsx(
        "rounded-xl border px-4 py-3 transition-colors duration-200",
        isCrit
          ? "border-red-700/35 bg-gradient-to-r from-red-950/20 to-zinc-950/30 hover:border-red-600/50"
          : "border-amber-700/30 bg-gradient-to-r from-amber-950/15 to-zinc-950/30 hover:border-amber-600/40"
      )}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <SeverityPip severity={incident.severity} />
          <StatusBadge status={incident.status} />
          <p className="font-mono text-[12px] font-semibold text-white truncate">
            {incident.title}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {incident.status === "open" && (
            <button
              type="button"
              onClick={() => act("ack")}
              disabled={loading !== null}
              className="font-mono text-[10px] font-bold px-3 py-1 rounded-lg border border-amber-600/40 bg-amber-950/20 text-amber-400 hover:bg-amber-950/40 hover:border-amber-500/60 transition-all disabled:opacity-40"
            >
              {loading === "ack" ? "…" : "Acknowledge"}
            </button>
          )}
          {(incident.status === "open" || incident.status === "acked") && (
            <button
              type="button"
              onClick={() => act("resolve")}
              disabled={loading !== null}
              className="font-mono text-[10px] font-bold px-3 py-1 rounded-lg border border-emerald-600/40 bg-emerald-950/20 text-emerald-400 hover:bg-emerald-950/40 hover:border-emerald-500/60 transition-all disabled:opacity-40"
            >
              {loading === "resolve" ? "…" : "Resolve"}
            </button>
          )}
        </div>
      </div>

      {/* Detail */}
      {incident.detail && (
        <p className="font-mono text-[10px] text-cyan-400 mt-1 ml-0.5 line-clamp-2">
          {incident.detail}
        </p>
      )}

      {/* Footer metadata */}
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        <span className="font-mono text-[9px] text-cyan-400 uppercase tracking-widest">{incident.category}</span>
        <span className="font-mono text-[9px] text-cyan-400">
          opened {timeAgo(incident.opened_at)}
        </span>
        {incident.status === "acked" && incident.acked_by && (
          <span className="font-mono text-[9px] text-blue-500/70">
            acked by {incident.acked_by} · {timeAgo(incident.acked_at)}
          </span>
        )}
        {incident.mtta_ms != null && (
          <span className="font-mono text-[9px] text-cyan-400">
            MTTA {fmtDuration(incident.mtta_ms)}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ─── Audit entry ──────────────────────────────────────────────────────────────
function AuditEntry({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const meta = actionMeta(entry.action);
  const hasDetail = entry.detail && Object.keys(entry.detail).length > 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/30 transition-colors cursor-default group"
    >
      {/* Icon */}
      <span className={clsx("font-mono text-[13px] flex-shrink-0 mt-0.5", meta.color)}>
        {meta.icon}
      </span>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={clsx("font-mono text-[11px] font-bold", meta.color)}>
            {fmtAction(entry.action)}
          </span>
          <span className="font-mono text-[9px] text-cyan-400 flex-shrink-0">
            {timeAgo(entry.created_at)}
          </span>
        </div>
        {entry.actor_email && (
          <span className="font-mono text-[10px] text-cyan-400">{entry.actor_email}</span>
        )}
        {hasDetail && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="font-mono text-[9px] text-cyan-500 hover:text-sky-300 mt-0.5 transition-colors"
          >
            {expanded ? "▲ hide" : "▼ detail"}
          </button>
        )}
        <AnimatePresence>
          {expanded && hasDetail && (
            <motion.pre
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="font-mono text-[9px] text-cyan-400 bg-zinc-900/60 rounded p-2 mt-1 overflow-x-auto"
            >
              {JSON.stringify(entry.detail, null, 2)}
            </motion.pre>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── System vitals card ───────────────────────────────────────────────────────
function VitalRow({
  label,
  value,
  ok,
  sub,
}: {
  label: string;
  value: string;
  ok: boolean | null;
  sub?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-zinc-800/40 last:border-0">
      <div>
        <p className="font-mono text-[11px] text-sky-200 font-semibold">{label}</p>
        {sub && <p className="font-mono text-[9px] text-cyan-400">{sub}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-sky-200">{value}</span>
        <span
          className={clsx(
            "w-2 h-2 rounded-full flex-shrink-0",
            ok === true
              ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
              : ok === false
                ? "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.7)] animate-pulse"
                : "bg-zinc-600"
          )}
        />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type IncidentsState = { incidents: AdminIncidentRow[]; loading: boolean; error: string | null; lastAt: string | null };
type AuditState = { entries: AuditLogEntry[]; total: number; loading: boolean; error: string | null; lastAt: string | null };
type HealthState = { payload: AdminHealthPayload | null; loading: boolean };

export function AdminOperationsDashboard() {
  const [incidents, setIncidents] = useState<IncidentsState>({ incidents: [], loading: true, error: null, lastAt: null });
  const [audit, setAudit] = useState<AuditState>({ entries: [], total: 0, loading: true, error: null, lastAt: null });
  const [health, setHealth] = useState<HealthState>({ payload: null, loading: true });
  const [auditAction, setAuditAction] = useState("");
  const [auditActor, setAuditActor] = useState("");

  // Load incidents
  const loadIncidents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/incidents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { incidents: AdminIncidentRow[] };
      setIncidents({ incidents: data.incidents ?? [], loading: false, error: null, lastAt: new Date().toISOString() });
    } catch (e) {
      setIncidents((s) => ({ ...s, loading: false, error: String(e) }));
    }
  }, []);

  // Load audit trail
  const loadAudit = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: "50" });
      if (auditAction) qs.set("action", auditAction);
      if (auditActor)  qs.set("actor", auditActor);
      const res = await fetch(`/api/admin/audit-log?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { entries: AuditLogEntry[]; total: number };
      setAudit({ entries: data.entries ?? [], total: data.total ?? 0, loading: false, error: null, lastAt: new Date().toISOString() });
    } catch (e) {
      setAudit((s) => ({ ...s, loading: false, error: String(e) }));
    }
  }, [auditAction, auditActor]);

  // Load health vitals
  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as AdminHealthPayload;
      setHealth({ payload: data, loading: false });
    } catch {
      setHealth((s) => ({ ...s, loading: false }));
    }
  }, []);

  // Initial + interval refresh
  useEffect(() => {
    loadIncidents();
    loadHealth();
    const id1 = setInterval(loadIncidents, REFRESH_MS);
    const id2 = setInterval(loadHealth, REFRESH_MS);
    return () => { clearInterval(id1); clearInterval(id2); };
  }, [loadIncidents, loadHealth]);

  useEffect(() => {
    loadAudit();
    const id = setInterval(loadAudit, AUDIT_MS);
    return () => clearInterval(id);
  }, [loadAudit]);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const critical = incidents.incidents.filter((i) => i.severity === "critical").length;
  const warning  = incidents.incidents.filter((i) => i.severity === "warning").length;
  const open     = incidents.incidents.filter((i) => i.status === "open").length;
  const acked    = incidents.incidents.filter((i) => i.status === "acked").length;
  const mttaAll  = incidents.incidents.map((i) => i.mtta_ms).filter((v): v is number => v != null);
  const avgMtta  = mttaAll.length > 0 ? Math.round(mttaAll.reduce((s, v) => s + v, 0) / mttaAll.length) : null;

  const h = health.payload;

  return (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <TabCommandHero
        kicker="Operations Center"
        title="Incidents"
        titleAccent="& Audit"
        subtitle="Real-time incident management · audit trail · system vitals · 20s auto-refresh"
        chips={
          <>
            <MetricChip label="critical" value={String(critical)} tone={critical > 0 ? "bear" : "neutral"} />
            <MetricChip label="warning"  value={String(warning)}  tone={warning  > 0 ? "amber" : "neutral"} />
            <MetricChip label="open"     value={String(open)}     tone={open     > 0 ? "bear" : "bull"} />
            <MetricChip label="audit"    value={`${audit.total} entries`} tone="violet" />
          </>
        }
        actions={<LivePill label="live · 20s refresh" active />}
      />

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MegaStat
          label="Critical"
          value={String(critical)}
          tone={critical > 0 ? "bear" : "neutral"}
          sub="open incidents"
        />
        <MegaStat
          label="Warning"
          value={String(warning)}
          tone={warning > 0 ? "amber" : "neutral"}
          sub="open incidents"
        />
        <MegaStat
          label="Acknowledged"
          value={String(acked)}
          tone={acked > 0 ? "violet" : "neutral"}
          sub="awaiting resolve"
        />
        <MegaStat
          label="Avg MTTA"
          value={avgMtta != null ? fmtDuration(avgMtta) : "—"}
          tone={avgMtta != null && avgMtta < 300_000 ? "bull" : "amber"}
          sub="mean time to ack"
        />
      </div>

      {/* ── Main grid: incidents (left) + vitals (right) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* ── Active Incidents ── */}
        <div className="xl:col-span-2">
          <GlassPanel
            title="Active Incidents"
            accent="bear"
            kicker={`${incidents.incidents.length} open · last updated ${timeAgo(incidents.lastAt)}`}
          >
            <div className="space-y-2 mt-1">
              {incidents.loading && incidents.incidents.length === 0 ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="admin-skeleton h-20 rounded-xl" />
                  ))}
                </div>
              ) : incidents.error ? (
                <p className="font-mono text-[11px] text-red-400 py-4 text-center">{incidents.error}</p>
              ) : incidents.incidents.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="font-mono text-[24px] mb-2">✓</p>
                  <p className="font-mono text-[12px] font-bold text-emerald-400">All Clear</p>
                  <p className="font-mono text-[10px] text-cyan-400 mt-1">No active incidents</p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {incidents.incidents.map((inc) => (
                    <IncidentRow key={inc.id} incident={inc} onRefresh={loadIncidents} />
                  ))}
                </AnimatePresence>
              )}
            </div>

            {incidents.incidents.length > 0 && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={loadIncidents}
                  className="font-mono text-[9px] text-cyan-400 hover:text-sky-200 transition-colors"
                >
                  ↺ refresh
                </button>
              </div>
            )}
          </GlassPanel>
        </div>

        {/* ── System Vitals ── */}
        <div>
          <GlassPanel title="System Vitals" accent="cyan" kicker="live · 20s refresh">
            {health.loading && !h ? (
              <div className="space-y-2 mt-2">
                {[1, 2, 3, 4].map((n) => <div key={n} className="admin-skeleton h-10 rounded" />)}
              </div>
            ) : (
              <div className="mt-2 space-y-0.5">
                <VitalRow
                  label="Database"
                  value={h?.market_health_ok ? "Connected" : "Degraded"}
                  ok={h?.market_health_ok ?? null}
                  sub="Postgres pool"
                />
                <VitalRow
                  label="Polygon WS"
                  value={h?.websockets.polygon_indices.authenticated ? "Live" : h?.websockets.polygon_indices.wsState ?? "—"}
                  ok={h?.websockets.polygon_indices.authenticated ?? null}
                  sub="index feed"
                />
                <VitalRow
                  label="UW Socket"
                  value={h?.websockets.unusual_whales.initialized ? "Live" : "Offline"}
                  ok={h != null ? (h.websockets.unusual_whales.initialized && !h.websockets.unusual_whales.auth_failed) : null}
                  sub="flow feed"
                />
                <VitalRow
                  label="API Errors"
                  value={String(h?.counts.api_errors ?? 0)}
                  ok={h != null ? (h.counts.api_errors === 0) : null}
                  sub="last 5 min window"
                />
                <VitalRow
                  label="Route Errors"
                  value={String(h?.route_errors?.length ?? 0)}
                  ok={h != null ? (h.route_errors?.length === 0) : null}
                  sub="recent 40 slots"
                />
                <VitalRow
                  label="Health Status"
                  value={h?.health_ok ? "OK" : h ? "DEGRADED" : "—"}
                  ok={h?.health_ok ?? null}
                  sub={`${h?.counts.critical ?? 0} crit · ${h?.counts.warning ?? 0} warn`}
                />

                {/* Recent route errors */}
                {(h?.route_errors?.length ?? 0) > 0 && (
                  <div className="mt-3 space-y-1 border-t border-zinc-800/40 pt-3">
                    <p className="font-mono text-[9px] text-cyan-400 uppercase tracking-widest mb-2">Recent Route Errors</p>
                    {h!.route_errors.slice(0, 4).map((e: { route?: string; message?: string; at?: string }, i: number) => (
                      <div key={i} className="font-mono text-[9px] rounded px-2 py-1 bg-red-950/20 border border-red-900/30">
                        <p className="text-red-400 font-bold">{e.route ?? "unknown"}</p>
                        <p className="text-cyan-400 truncate">{e.message ?? "Error"}</p>
                        <p className="text-cyan-500">{timeAgo(e.at ?? "")}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </GlassPanel>
        </div>
      </div>

      {/* ── Audit Trail ── */}
      <GlassPanel title="Audit Trail" accent="violet" kicker={`${audit.total} total actions logged`}>
        {/* Filters */}
        <div className="flex items-center gap-3 mt-2 mb-3">
          <input
            value={auditAction}
            onChange={(e) => setAuditAction(e.target.value)}
            placeholder="filter by action…"
            className="font-mono text-[10px] bg-zinc-900 border border-zinc-700/50 rounded px-2 py-1 text-sky-200 placeholder-zinc-700 outline-none focus:border-violet-500/60 transition-colors w-40"
          />
          <input
            value={auditActor}
            onChange={(e) => setAuditActor(e.target.value)}
            placeholder="filter by actor email…"
            className="font-mono text-[10px] bg-zinc-900 border border-zinc-700/50 rounded px-2 py-1 text-sky-200 placeholder-zinc-700 outline-none focus:border-violet-500/60 transition-colors w-44"
          />
          {(auditAction || auditActor) && (
            <button
              type="button"
              onClick={() => { setAuditAction(""); setAuditActor(""); }}
              className="font-mono text-[9px] text-cyan-400 hover:text-sky-200 transition-colors"
            >
              × clear
            </button>
          )}
          <span className="ml-auto font-mono text-[9px] text-cyan-500">
            last updated {timeAgo(audit.lastAt)}
          </span>
        </div>

        {audit.loading && audit.entries.length === 0 ? (
          <div className="space-y-1">
            {[1, 2, 3, 4, 5].map((n) => <div key={n} className="admin-skeleton h-8 rounded" />)}
          </div>
        ) : audit.error ? (
          <p className="font-mono text-[11px] text-red-400 py-4 text-center">{audit.error}</p>
        ) : audit.entries.length === 0 ? (
          <div className="py-8 text-center">
            <p className="font-mono text-[11px] text-cyan-400">No audit entries found</p>
            {!audit.entries.length && !audit.loading && (
              <p className="font-mono text-[9px] text-cyan-500 mt-1">
                Actions are logged as admins use the dashboard
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            <AnimatePresence initial={false}>
              {audit.entries.map((entry) => (
                <AuditEntry key={entry.id} entry={entry} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
