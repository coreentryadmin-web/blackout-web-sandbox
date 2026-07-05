"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import {
  ActionButton,
  EmptyDeck,
  FilterSearch,
  GlassPanel,
  LivePill,
  MegaStat,
  MetricChip,
  TabCommandHero,
} from "@/components/admin/AdminUi";
import { useAdminHealth, useAdminIncidents } from "@/hooks/use-admin-data";
import type { AdminIncidentRow } from "@/lib/admin-incidents";
import type { AuditLogEntry } from "@/app/api/admin/audit-log/route";
import type { AdminHealthPayload } from "@/lib/admin-health";

type ErrorEventRow = {
  id: number;
  source: string;
  scope: string | null;
  name: string;
  message: string;
  stack: string | null;
  meta_json: unknown;
  created_at: string;
};

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

// ─── Action icon + color map (brand tones only) ────────────────────────────────
const ACTION_META: Record<string, { icon: string; color: string }> = {
  api_probe_providers: { icon: "⬡", color: "text-cyan"   },
  api_event_view:      { icon: "◉", color: "text-sky-300" },
  api_rescan:          { icon: "↺", color: "text-sky-300" },
  spx_live_engine:     { icon: "◎", color: "text-gold"   },
  incident_ack:        { icon: "✓", color: "text-gold"   },
  incident_resolve:    { icon: "✓", color: "text-bull"   },
};

function actionMeta(action: string) {
  for (const [key, val] of Object.entries(ACTION_META)) {
    if (action.startsWith(key)) return val;
  }
  return { icon: "·", color: "text-cyan" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityPip({ severity }: { severity: string }) {
  const isCrit = severity === "critical";
  return (
    <span
      className={clsx(
        "admin-outcome-badge font-black tracking-widest select-none",
        isCrit ? "admin-outcome-badge-bear" : "admin-outcome-badge-amber"
      )}
    >
      {isCrit ? "● CRITICAL" : "WARNING"}
    </span>
  );
}

function StatusBadge({ status }: { status: AdminIncidentRow["status"] }) {
  return (
    <span
      className={clsx(
        "admin-outcome-badge text-[10px] font-bold tracking-widest",
        status === "open" ? "admin-outcome-badge-bear" : "admin-outcome-badge-neutral"
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
          ? "border-bear/35 bg-gradient-to-r from-bear/10 to-black/40 hover:border-bear/50"
          : "border-gold/30 bg-gradient-to-r from-gold/10 to-black/40 hover:border-gold/45"
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
            <ActionButton onClick={() => act("ack")} disabled={loading !== null}>
              {loading === "ack" ? "…" : "Acknowledge"}
            </ActionButton>
          )}
          {(incident.status === "open" || incident.status === "acked") && (
            <ActionButton
              onClick={() => act("resolve")}
              disabled={loading !== null}
              variant="primary"
            >
              {loading === "resolve" ? "…" : "Resolve"}
            </ActionButton>
          )}
        </div>
      </div>

      {/* Detail */}
      {incident.detail && (
        <p className="font-mono text-[10px] text-sky-300 mt-1 ml-0.5 line-clamp-2">
          {incident.detail}
        </p>
      )}

      {/* Footer metadata */}
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        <span className="font-mono text-[10px] text-cyan uppercase tracking-widest">{incident.category}</span>
        <span className="font-mono text-[10px] text-cyan">
          opened {timeAgo(incident.opened_at)}
        </span>
        {incident.status === "acked" && incident.acked_by && (
          <span className="font-mono text-[10px] text-sky-300/70">
            acked by {incident.acked_by} · {timeAgo(incident.acked_at)}
          </span>
        )}
        {incident.mtta_ms != null && (
          <span className="font-mono text-[10px] text-cyan">
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
      className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-default group"
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
          <span className="font-mono text-[10px] text-cyan flex-shrink-0">
            {timeAgo(entry.created_at)}
          </span>
        </div>
        {entry.actor_email && (
          <span className="font-mono text-[10px] text-cyan">{entry.actor_email}</span>
        )}
        {hasDetail && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="font-mono text-[10px] text-cyan hover:text-sky-300 mt-0.5 transition-colors"
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
              className="font-mono text-[10px] text-sky-300 bg-black/60 border border-white/10 rounded p-2 mt-1 overflow-x-auto"
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
    <div className="flex items-center justify-between py-2 border-b border-white/10 last:border-0">
      <div>
        <p className="font-mono text-[11px] text-sky-200 font-semibold">{label}</p>
        {sub && <p className="font-mono text-[10px] text-cyan">{sub}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-sky-200">{value}</span>
        <span
          className={clsx(
            "w-2 h-2 rounded-full flex-shrink-0",
            ok === true
              ? "bg-bull shadow-[0_0_6px_rgba(0,230,118,0.7)]"
              : ok === false
                ? "bg-bear shadow-[0_0_6px_rgba(255,45,85,0.7)] animate-pulse"
                : "bg-white/20"
          )}
        />
      </div>
    </div>
  );
}

// ─── Data Pipeline Health tile ────────────────────────────────────────────────

type UwStores = {
  tide_updated_at: number | null;
  dark_pool_updated_at: number | null;
  interval_flow_updated_at: number | null;
  trading_halts_updated_at: number | null;
  net_flow_updated_at: number | null;
  option_trades_updated_at: number | null;
  option_trades_buffered?: number;
  lit_trades_updated_at: number | null;
  lit_trades_buffered?: number;
  gex_strike_expiry_updated_at?: number | null;
  gex_strike_expiry_strikes?: number;
  price_spx_updated_at?: number | null;
  active_halts: string[];
};

function storeAge(updatedAt: number | null): { label: string; ok: boolean | null } {
  if (updatedAt == null || updatedAt === 0) return { label: "No data", ok: null };
  const age = Date.now() - updatedAt;
  const s = Math.floor(age / 1000);
  if (s < 10) return { label: "just now", ok: true };
  if (s < 60) return { label: `${s}s ago`, ok: true };
  const m = Math.floor(s / 60);
  if (m < 5) return { label: `${m}m ago`, ok: true };
  if (m < 15) return { label: `${m}m ago`, ok: false };
  return { label: `${m}m ago`, ok: false };
}

function PipelineRow({
  label,
  updatedAt,
  handlers,
  wsState,
}: {
  label: string;
  updatedAt: number | null;
  handlers?: number;
  wsState?: string;
}) {
  const age = storeAge(updatedAt);
  const handlerOk = handlers == null || handlers > 0;
  const wsOk = wsState == null || wsState === "OPEN";
  const ok = age.ok === true && handlerOk && wsOk ? true : age.ok === false ? false : null;
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/10 last:border-0">
      <div>
        <p className="font-mono text-[11px] text-sky-200 font-semibold">{label}</p>
        <p className="font-mono text-[10px] text-cyan">
          {handlers != null ? `${handlers} handler${handlers !== 1 ? "s" : ""}` : "store"}
          {wsState ? ` · ws ${wsState}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-sky-200">{age.label}</span>
        <span
          className={clsx(
            "w-2 h-2 rounded-full flex-shrink-0",
            ok === true
              ? "bg-bull shadow-[0_0_6px_rgba(0,230,118,0.7)]"
              : ok === false
                ? "bg-bear shadow-[0_0_6px_rgba(255,45,85,0.7)] animate-pulse"
                : "bg-white/20"
          )}
        />
      </div>
    </div>
  );
}

function DataPipelineHealthTile({ health }: { health: AdminHealthPayload | null }) {
  const uw = health?.websockets.unusual_whales;
  const luld = health?.websockets.stocks_luld;
  const stores = uw?.stores as UwStores | undefined;
  const channels = uw?.channels as Record<string, { ws_state: string; handlers: number; authenticated: boolean }> | undefined;

  // UW GEX cross-check uses gex_strike_expiry WS when fresh (REST fallback in gex-cross-validation).
  const uwAuthOk = uw != null && uw.initialized && !uw.auth_failed;
  const luldLive = luld?.enabled === true && luld.authenticated && luld.ws_state === "open";

  const STORE_DEFS: Array<{ key: keyof UwStores & `${string}_updated_at`; label: string; channel: string }> = [
    { key: "tide_updated_at",         label: "Market Tide",    channel: "market_tide"   },
    { key: "dark_pool_updated_at",    label: "Dark Pool",      channel: "off_lit_trades" },
    { key: "interval_flow_updated_at", label: "Interval Flow", channel: "interval_flow"  },
    { key: "net_flow_updated_at",     label: "Net Flow (SPX)", channel: "net_flow"       },
    { key: "option_trades_updated_at", label: "Option Tape",   channel: "option_trades"  },
    { key: "lit_trades_updated_at",   label: "Lit Trades",     channel: "lit_trades"     },
    { key: "gex_strike_expiry_updated_at", label: "GEX Strike Expiry", channel: "gex_strike_expiry" },
    { key: "price_spx_updated_at", label: "UW Price (SPX)", channel: "price" },
  ];

  return (
    <GlassPanel
      title="Data Pipeline Health"
      accent="cyan"
      kicker="UW WS stores · live data · 20s refresh"
    >
      {health == null ? (
        <div className="space-y-1 mt-2">
          {[1, 2, 3, 4].map((n) => <div key={n} className="admin-skeleton h-10 rounded" />)}
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <div>
            {STORE_DEFS.map(({ key, label, channel }) => {
              const ch = channels?.[channel];
              return (
                <PipelineRow
                  key={key}
                  label={label}
                  updatedAt={stores?.[key] as number | null ?? null}
                  handlers={ch?.handlers}
                  wsState={ch?.ws_state}
                />
              );
            })}
          </div>
          <div>
            {/* UW multiplex auth (all channels share one socket) */}
            <div className="flex items-center justify-between py-2 border-b border-white/10">
              <div>
                <p className="font-mono text-[11px] text-sky-200 font-semibold">UW Multiplex</p>
                <p className="font-mono text-[10px] text-cyan">socket auth · leader election</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-bold text-sky-200">
                  {uw == null ? "—" : uwAuthOk ? "Live" : "Degraded"}
                </span>
                <span
                  className={clsx(
                    "w-2 h-2 rounded-full flex-shrink-0",
                    uw == null
                      ? "bg-white/20"
                      : uwAuthOk
                        ? "bg-bull shadow-[0_0_6px_rgba(0,230,118,0.7)]"
                        : "bg-bear shadow-[0_0_6px_rgba(255,45,85,0.7)] animate-pulse"
                  )}
                />
              </div>
            </div>
            {/* Active halts summary */}
            <div className="flex items-center justify-between py-2 border-b border-white/10">
              <div>
                <p className="font-mono text-[11px] text-sky-200 font-semibold">Active Halts</p>
                <p className="font-mono text-[10px] text-cyan">UW + Massive LULD</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-bold text-sky-200">
                  {stores?.active_halts?.length ?? 0} symbols
                </span>
                <span
                  className={clsx(
                    "w-2 h-2 rounded-full flex-shrink-0",
                    (stores?.active_halts?.length ?? 0) === 0
                      ? "bg-bull shadow-[0_0_6px_rgba(0,230,118,0.7)]"
                      : "bg-bear shadow-[0_0_6px_rgba(255,45,85,0.7)] animate-pulse"
                  )}
                />
              </div>
            </div>
            {/* Massive LULD halt feed (second source) */}
            <div className="flex items-center justify-between py-2 border-b border-white/10">
              <div>
                <p className="font-mono text-[11px] text-sky-200 font-semibold">Massive LULD</p>
                <p className="font-mono text-[10px] text-cyan">
                  {luld?.enabled ? (luld.tickers?.join(", ") ?? "SPY") : "STOCKS_WS_ENABLED=off"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-bold text-sky-200">
                  {luld == null ? "—" : !luld.enabled ? "Disabled" : luldLive ? "Live" : "Degraded"}
                </span>
                <span
                  className={clsx(
                    "w-2 h-2 rounded-full flex-shrink-0",
                    luld == null || !luld.enabled
                      ? "bg-white/20"
                      : luldLive
                        ? "bg-bull shadow-[0_0_6px_rgba(0,230,118,0.7)]"
                        : "bg-bear shadow-[0_0_6px_rgba(255,45,85,0.7)] animate-pulse"
                  )}
                />
              </div>
            </div>
            {/* UW socket initialized */}
            <div className="flex items-center justify-between py-2 border-b border-white/10">
              <div>
                <p className="font-mono text-[11px] text-sky-200 font-semibold">UW Socket</p>
                <p className="font-mono text-[10px] text-cyan">multiplex · all channels</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-bold text-sky-200">
                  {uw?.initialized ? (uw.auth_failed ? "Auth Failed" : "Live") : "Offline"}
                </span>
                <span
                  className={clsx(
                    "w-2 h-2 rounded-full flex-shrink-0",
                    uwAuthOk
                      ? "bg-bull shadow-[0_0_6px_rgba(0,230,118,0.7)]"
                      : health != null
                        ? "bg-bear shadow-[0_0_6px_rgba(255,45,85,0.7)] animate-pulse"
                        : "bg-white/20"
                  )}
                />
              </div>
            </div>
            {stores?.active_halts && stores.active_halts.length > 0 && (
              <div className="mt-2 px-2 py-1.5 rounded bg-bear/10 border border-bear/30">
                <p className="font-mono text-[10px] text-bear font-bold">
                  Halted: {stores.active_halts.join(", ")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </GlassPanel>
  );
}

// ─── Error event row ──────────────────────────────────────────────────────────
function ErrorEventRowView({ event }: { event: ErrorEventRow }) {
  const [expanded, setExpanded] = useState(false);
  const hasStack = Boolean(event.stack?.trim());

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-lg border border-white/10 bg-black/30 px-3 py-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-bold text-bear truncate">
            {event.source}
            {event.scope ? ` · ${event.scope}` : ""}
          </p>
          <p className="font-mono text-[10px] text-sky-300 mt-0.5 line-clamp-2">{event.message}</p>
        </div>
        <span className="font-mono text-[10px] text-cyan flex-shrink-0">{timeAgo(event.created_at)}</span>
      </div>
      {hasStack && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="font-mono text-[10px] text-cyan hover:text-sky-300 mt-1 transition-colors"
        >
          {expanded ? "▲ hide stack" : "▼ stack"}
        </button>
      )}
      <AnimatePresence>
        {expanded && hasStack && (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="font-mono text-[10px] text-sky-300 bg-black/60 border border-white/10 rounded p-2 mt-1 overflow-x-auto max-h-40"
          >
            {event.stack}
          </motion.pre>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type IncidentsState = { incidents: AdminIncidentRow[]; loading: boolean; error: string | null; lastAt: string | null };
type AuditState = { entries: AuditLogEntry[]; total: number; loading: boolean; error: string | null; lastAt: string | null };
type HealthState = { payload: AdminHealthPayload | null; loading: boolean };
type ErrorsState = { events: ErrorEventRow[]; loading: boolean; error: string | null; lastAt: string | null };

export function AdminOperationsDashboard() {
  // Shared (SWR, keyed by URL) with every other admin panel reading the same data —
  // this dashboard no longer runs its own independent poll loop for either.
  const { data: healthData, isLoading: healthLoading } = useAdminHealth();
  const health: HealthState = { payload: healthData ?? null, loading: healthLoading };

  const { data: incidentsData, error: incidentsErrorObj, isLoading: incidentsLoading, mutate: refreshIncidents } =
    useAdminIncidents();
  const incidents: IncidentsState = {
    incidents: incidentsData?.incidents ?? [],
    loading: incidentsLoading,
    error: incidentsErrorObj ? String(incidentsErrorObj) : null,
    lastAt: incidentsData?.generated_at ?? null,
  };
  const loadIncidents = useCallback(() => {
    void refreshIncidents();
  }, [refreshIncidents]);

  const [audit, setAudit] = useState<AuditState>({ entries: [], total: 0, loading: true, error: null, lastAt: null });
  const [errors, setErrors] = useState<ErrorsState>({ events: [], loading: true, error: null, lastAt: null });
  const [auditAction, setAuditAction] = useState("");
  const [auditActor, setAuditActor] = useState("");

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

  const loadErrors = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/errors?limit=50");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { events: ErrorEventRow[] };
      setErrors({
        events: data.events ?? [],
        loading: false,
        error: null,
        lastAt: new Date().toISOString(),
      });
    } catch (e) {
      setErrors((s) => ({ ...s, loading: false, error: String(e) }));
    }
  }, []);

  // Initial + interval refresh — health + incidents now come from the shared SWR hooks above
  // (their own poll loops), only errors still needs its own here.
  useEffect(() => {
    loadErrors();
    const id = setInterval(loadErrors, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadErrors]);

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
        subtitle="Real-time incident management · error sink · audit trail · system vitals · 20s auto-refresh"
        chips={
          <>
            <MetricChip label="critical" value={String(critical)} tone={critical > 0 ? "bear" : "neutral"} />
            <MetricChip label="warning"  value={String(warning)}  tone={warning  > 0 ? "amber" : "neutral"} />
            <MetricChip label="open"     value={String(open)}     tone={open     > 0 ? "bear" : "bull"} />
            <MetricChip label="errors"   value={String(errors.events.length)} tone={errors.events.length > 0 ? "bear" : "bull"} />
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
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 gap-4">

        {/* ── Active Incidents ── */}
        <div className="md:col-span-2 lg:col-span-2 xl:col-span-2">
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
                <p className="font-mono text-[11px] text-bear py-4 text-center">{incidents.error}</p>
              ) : incidents.incidents.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="font-mono text-[24px] mb-2 text-bull">✓</p>
                  <p className="font-mono text-[12px] font-bold text-bull">All Clear</p>
                  <p className="font-mono text-[10px] text-cyan mt-1">No active incidents</p>
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
                  className="font-mono text-[10px] text-cyan hover:text-sky-200 transition-colors"
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
                  sub={h?.ops_config?.pg_pooler_hint ?? "Postgres pool"}
                />
                <VitalRow
                  label="PgBouncer"
                  value={h?.ops_config?.database_via_pooler ? "Via pooler" : "Direct"}
                  ok={h?.ops_config?.database_via_pooler ?? null}
                  sub={`PG_POOL_MAX=${h?.ops_config?.pg_pool_max ?? "—"}`}
                />
                <VitalRow
                  label="AI kill-switch"
                  value={
                    h?.ops_config?.ai_spend_kill_switch_armed
                      ? `$${h.ops_config.ai_spend_kill_usd}/day`
                      : "Unarmed"
                  }
                  ok={h?.ops_config?.ai_spend_kill_switch_armed ?? null}
                  sub={`alert @ $${h?.ops_config?.ai_spend_alert_usd ?? "—"}/day`}
                />
                <VitalRow
                  label="Discord ops"
                  value={h?.ops_config?.discord_ops_webhook ? "Configured" : "Missing"}
                  ok={h?.ops_config?.discord_ops_webhook ?? null}
                  sub={
                    h?.ops_config?.discord_play_webhook ? "play webhook set" : "play webhook unset"
                  }
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
                  label="Options WS"
                  value={
                    h == null
                      ? "—"
                      : !h.websockets.options.enabled
                        ? "Disabled"
                        : h.websockets.options.shards.some((s) => s.authenticated)
                          ? "Live"
                          : "Down"
                  }
                  ok={
                    h == null
                      ? null
                      : !h.websockets.options.enabled
                        ? null
                        : h.websockets.options.shards.some((s) => s.authenticated)
                  }
                  sub={`Massive marks · ${h?.websockets.options.marks_in_memory ?? 0} in memory`}
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
                  label="Premium launch gate"
                  value={
                    h?.launch_status
                      ? `${h.launch_status.open_count}/${h.launch_status.total_count} open`
                      : "—"
                  }
                  ok={
                    h?.launch_status
                      ? h.launch_status.open_count === h.launch_status.total_count ||
                        (h.launch_status.open_count === 5 &&
                          h.launch_status.locked_keys.length === 1 &&
                          h.launch_status.locked_keys[0] === "largo")
                      : null
                  }
                  sub={
                    h?.launch_status?.launched_tools_env
                      ? `LAUNCHED_TOOLS=${h.launch_status.launched_tools_env}`
                      : h?.launch_status
                        ? "LAUNCHED_TOOLS unset (defaults: all except Largo)"
                        : undefined
                  }
                />
                <VitalRow
                  label="Health Status"
                  value={h?.health_ok ? "OK" : h ? "DEGRADED" : "—"}
                  ok={h?.health_ok ?? null}
                  sub={`${h?.counts.critical ?? 0} crit · ${h?.counts.warning ?? 0} warn`}
                />

                {/* Recent route errors */}
                {(h?.route_errors?.length ?? 0) > 0 && (
                  <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
                    <p className="font-mono text-[10px] text-cyan uppercase tracking-widest mb-2">Recent Route Errors</p>
                    {h!.route_errors.slice(0, 4).map((e: { route?: string; message?: string; at?: string }, i: number) => (
                      <div key={i} className="font-mono text-[10px] rounded px-2 py-1 bg-bear/10 border border-bear/30">
                        <p className="text-bear font-bold">{e.route ?? "unknown"}</p>
                        <p className="text-cyan truncate">{e.message ?? "Error"}</p>
                        <p className="text-sky-300/70">{timeAgo(e.at ?? "")}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </GlassPanel>
        </div>
      </div>

      {/* ── Data Pipeline Health ── */}
      <DataPipelineHealthTile health={h} />

      {/* ── Durable error sink (error_events) ── */}
      <GlassPanel
        title="Error Sink"
        accent="bear"
        kicker={`${errors.events.length} recent · Postgres error_events · last updated ${timeAgo(errors.lastAt)}`}
      >
        <div className="mt-2 space-y-2">
          {errors.loading && errors.events.length === 0 ? (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="admin-skeleton h-14 rounded-lg" />
              ))}
            </div>
          ) : errors.error ? (
            <p className="font-mono text-[11px] text-bear py-4 text-center">{errors.error}</p>
          ) : errors.events.length === 0 ? (
            <div className="py-8 text-center">
              <p className="font-mono text-[24px] mb-2 text-bull">✓</p>
              <p className="font-mono text-[12px] font-bold text-bull">Error sink clear</p>
              <p className="font-mono text-[10px] text-cyan mt-1">No durable errors in the last 50 rows</p>
            </div>
          ) : (
            errors.events.slice(0, 12).map((event) => (
              <ErrorEventRowView key={event.id} event={event} />
            ))
          )}
        </div>
        {errors.events.length > 0 && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={loadErrors}
              className="font-mono text-[10px] text-cyan hover:text-sky-200 transition-colors"
            >
              ↺ refresh
            </button>
          </div>
        )}
      </GlassPanel>

      {/* ── Audit Trail ── */}
      <GlassPanel title="Audit Trail" accent="violet" kicker={`${audit.total} total actions logged`}>
        {/* Filters */}
        <div className="flex items-end gap-3 mt-2 mb-3 flex-wrap">
          <FilterSearch
            label="Action"
            value={auditAction}
            onChange={setAuditAction}
            placeholder="filter by action…"
          />
          <FilterSearch
            label="Actor"
            value={auditActor}
            onChange={setAuditActor}
            placeholder="filter by actor email…"
          />
          {(auditAction || auditActor) && (
            <button
              type="button"
              onClick={() => { setAuditAction(""); setAuditActor(""); }}
              className="font-mono text-[10px] text-cyan hover:text-sky-200 transition-colors pb-2"
            >
              × clear
            </button>
          )}
          <span className="ml-auto font-mono text-[10px] text-cyan pb-2">
            last updated {timeAgo(audit.lastAt)}
          </span>
        </div>

        {audit.loading && audit.entries.length === 0 ? (
          <div className="space-y-1">
            {[1, 2, 3, 4, 5].map((n) => <div key={n} className="admin-skeleton h-8 rounded" />)}
          </div>
        ) : audit.error ? (
          <p className="font-mono text-[11px] text-bear py-4 text-center">{audit.error}</p>
        ) : audit.entries.length === 0 ? (
          <EmptyDeck
            title="No audit entries found"
            hint="Actions are logged as admins use the dashboard"
          />
        ) : (
          <div className="divide-y divide-white/10">
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
