"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "clsx";
import type { SpxAdminDashboardPayload } from "@/lib/admin-spx-dashboard";
import type { SpxTerminalLine } from "@/lib/admin-spx-terminal";

type FeedFilter = "all" | "critical" | "warning" | "api" | "pulse" | "info";

const FILTER_OPTIONS: Array<{ id: FeedFilter; label: string }> = [
  { id: "all", label: "ALL" },
  { id: "critical", label: "CRIT" },
  { id: "warning", label: "WARN" },
  { id: "api", label: "API" },
  { id: "pulse", label: "PULSE" },
  { id: "info", label: "INFO" },
];

function fmtClockEt(): string {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function fmtRel(iso: string): string {
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 3) return "now";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function lineMatchesFilter(line: SpxTerminalLine, filter: FeedFilter): boolean {
  if (filter === "all") return true;
  if (filter === "info") return line.kind === "info" || line.kind === "ok";
  return line.kind === filter;
}

function TerminalSeparator({ variant }: { variant: "dash" | "dot" }) {
  const text =
    variant === "dash" ? "─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─" : "· · · · · · · · · · · · · · · · · · ·";
  return (
    <div className="admin-spx-term-sep" aria-hidden>
      <span>{text}</span>
    </div>
  );
}

function TerminalLineRow({
  line,
  index,
  isNew,
}: {
  line: SpxTerminalLine;
  index: number;
  isNew: boolean;
}) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, x: -24, filter: "blur(4px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: Math.min(index * 0.02, 0.12) }}
      className={clsx("admin-spx-term-line", `admin-spx-term-line-${line.kind}`, isNew && "admin-spx-term-line-new")}
    >
      <div className="admin-spx-term-line-rail" aria-hidden />
      <div className="admin-spx-term-line-body">
        <header className="admin-spx-term-line-head">
          <span className="admin-spx-term-marker">{line.marker}</span>
          <span className={clsx("admin-spx-term-kind", `admin-spx-term-kind-${line.kind}`)}>
            {line.kind === "api" ? "API" : line.kind.toUpperCase()}
          </span>
          <span className="admin-spx-term-cat">{line.category}</span>
          <span className="admin-spx-term-time">{fmtRel(line.at)}</span>
        </header>
        <h3 className="admin-spx-term-headline">{line.headline}</h3>
        <p className="admin-spx-term-detail">{line.detail}</p>
        {line.meta && <p className="admin-spx-term-meta">{line.meta}</p>}
      </div>
    </motion.article>
  );
}

export function AdminSpxTerminal({
  data,
  loading,
  onRefresh,
}: {
  data: SpxAdminDashboardPayload;
  loading?: boolean;
  onRefresh?: () => void;
}) {
  const terminal = data.terminal;
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [clock, setClock] = useState(fmtClockEt());
  const [paused, setPaused] = useState(false);
  const seenRef = useRef(new Set<string>());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setClock(fmtClockEt()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const fresh = new Set<string>();
    for (const line of terminal.lines) {
      if (!seenRef.current.has(line.id)) {
        fresh.add(line.id);
        seenRef.current.add(line.id);
      }
    }
    if (fresh.size > 0) {
      setNewIds(fresh);
      const t = setTimeout(() => setNewIds(new Set()), 2400);
      return () => clearTimeout(t);
    }
  }, [terminal.lines]);

  useEffect(() => {
    if (paused || !feedRef.current) return;
    feedRef.current.scrollTop = 0;
  }, [terminal.stream_at, paused]);

  const filtered = useMemo(
    () => terminal.lines.filter((line) => lineMatchesFilter(line, filter)),
    [terminal.lines, filter]
  );

  const healthLabel = terminal.health_ok
    ? terminal.counts.critical > 0
      ? "DEGRADED"
      : terminal.counts.warning > 0
        ? "CAUTION"
        : "NOMINAL"
    : "DEGRADED";

  const healthClass =
    terminal.counts.critical > 0 ? "bear" : terminal.counts.warning > 0 ? "amber" : "bull";

  const incidentAction = async (id: string, action: "ack" | "resolve") => {
    try {
      const res = await fetch("/api/admin/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (res.ok && onRefresh) onRefresh();
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="admin-spx-terminal">
      <div className="admin-spx-term-chrome">
        <div className="admin-spx-term-chrome-glow" aria-hidden />
        <div className="admin-spx-term-chrome-scan" aria-hidden />

        <header className="admin-spx-term-header">
          <div>
            <p className="admin-spx-term-kicker">Blackout · SPX Slayer</p>
            <h2 className="admin-spx-term-title">Terminal</h2>
            <p className="admin-spx-term-sub">
              Live system feed · errors · failures · engine pulses · API telemetry
            </p>
          </div>
          <div className="admin-spx-term-header-right">
            <span className={clsx("admin-spx-term-stream-pill", !loading && "admin-spx-term-stream-pill-live")}>
              <span className="admin-spx-term-stream-dot" />
              {loading ? "SYNC…" : "LIVE"}
            </span>
            <span className="admin-spx-term-clock">{clock} ET</span>
            {onRefresh && (
              <button type="button" className="admin-spx-term-refresh" onClick={onRefresh} disabled={loading}>
                ↻
              </button>
            )}
          </div>
        </header>

        <div className="admin-spx-term-stats">
          <div className={clsx("admin-spx-term-stat", `admin-spx-term-stat-${healthClass}`)}>
            <span className="admin-spx-term-stat-label">Health</span>
            <span className="admin-spx-term-stat-value">{healthLabel}</span>
          </div>
          <div className="admin-spx-term-stat admin-spx-term-stat-bear">
            <span className="admin-spx-term-stat-label">Critical</span>
            <span className="admin-spx-term-stat-value">{terminal.counts.critical}</span>
          </div>
          <div className="admin-spx-term-stat admin-spx-term-stat-amber">
            <span className="admin-spx-term-stat-label">Warnings</span>
            <span className="admin-spx-term-stat-value">{terminal.counts.warning}</span>
          </div>
          <div className="admin-spx-term-stat admin-spx-term-stat-violet">
            <span className="admin-spx-term-stat-label">API</span>
            <span className="admin-spx-term-stat-value">{terminal.counts.api}</span>
          </div>
          <div className="admin-spx-term-stat admin-spx-term-stat-cyan">
            <span className="admin-spx-term-stat-label">Pulse</span>
            <span className="admin-spx-term-stat-value">{terminal.counts.pulse}</span>
          </div>
          <div className="admin-spx-term-stat admin-spx-term-stat-neutral">
            <span className="admin-spx-term-stat-label">Lines</span>
            <span className="admin-spx-term-stat-value">{filtered.length}</span>
          </div>
        </div>

        {data.open_incidents.length > 0 && (
          <div className="admin-spx-term-incidents">
            <p className="admin-spx-term-incidents-title">Open incidents · ack to record MTTA</p>
            {data.open_incidents.map((inc) => (
              <div key={inc.id} className={clsx("admin-spx-term-incident", `admin-spx-term-incident-${inc.severity}`)}>
                <div>
                  <p className="admin-spx-term-incident-head">{inc.title}</p>
                  <p className="admin-spx-term-incident-detail">{inc.detail}</p>
                  <p className="admin-spx-term-incident-meta">
                    {inc.status.toUpperCase()}
                    {inc.mtta_ms != null
                      ? ` · MTTA ${Math.round(inc.mtta_ms / 1000)}s`
                      : ` · open ${Math.round((Date.now() - new Date(inc.opened_at).getTime()) / 1000)}s`}
                  </p>
                </div>
                <div className="admin-spx-term-incident-actions">
                  {inc.status === "open" && (
                    <button type="button" className="admin-spx-term-incident-btn" onClick={() => incidentAction(inc.id, "ack")}>
                      Ack
                    </button>
                  )}
                  <button type="button" className="admin-spx-term-incident-btn admin-spx-term-incident-btn-muted" onClick={() => incidentAction(inc.id, "resolve")}>
                    Resolve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="admin-spx-term-toolbar">
          <div className="admin-spx-term-filters">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={clsx("admin-spx-term-filter", filter === opt.id && "admin-spx-term-filter-active")}
                onClick={() => setFilter(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={clsx("admin-spx-term-pause", paused && "admin-spx-term-pause-active")}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? "Resume scroll" : "Pause scroll"}
          </button>
        </div>

        <div className="admin-spx-term-feed-wrap">
          <div className="admin-spx-term-feed" ref={feedRef}>
            <AnimatePresence initial={false} mode="popLayout">
              {filtered.length === 0 ? (
                <motion.p
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="admin-spx-term-empty"
                >
                  No lines match filter — system may be clear.
                </motion.p>
              ) : (
                filtered.map((line, index) => (
                  <div key={line.id}>
                    <TerminalLineRow line={line} index={index} isNew={newIds.has(line.id)} />
                    {index < filtered.length - 1 && (
                      <TerminalSeparator
                        variant={
                          line.kind === "pulse" || filtered[index + 1]?.kind === "pulse" ? "dot" : "dash"
                        }
                      />
                    )}
                  </div>
                ))
              )}
            </AnimatePresence>
            <div className="admin-spx-term-cursor" aria-hidden>
              <span className="admin-spx-term-cursor-blink">_</span>
            </div>
          </div>
        </div>

        <footer className="admin-spx-term-footer">
          <span>
            Stream{" "}
            {new Date(terminal.stream_at).toLocaleTimeString("en-US", {
              timeZone: "America/New_York",
              hour12: false,
            })}
          </span>
          <span>·</span>
          <span>{data.live_engine ? "Live engine" : "Desk snapshot"}</span>
          <span>·</span>
          <span>{data.desk.market.open ? "Market open" : "Market closed"}</span>
          <span>·</span>
          <span>SPX {data.desk.price_action.price as number}</span>
        </footer>
      </div>
    </section>
  );
}
