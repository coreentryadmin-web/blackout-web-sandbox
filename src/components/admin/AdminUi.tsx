"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Modal } from "@/components/ui";

export function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export function WinRateRing({
  value,
  label,
  sub,
  tone = "bull",
  size = 120,
}: {
  value: number;
  label: string;
  sub?: string;
  tone?: "bull" | "bear" | "violet" | "cyan" | "amber";
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const stroke = Math.round(size * 0.08);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped);

  return (
    <div className={clsx("admin-ring", `admin-ring-${tone}`)}>
      <svg aria-hidden="true" width={size} height={size} className="admin-ring-svg">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="admin-ring-track"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="admin-ring-progress"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="admin-ring-center">
        <span className="admin-ring-value">{pct(clamped)}</span>
        <span className="admin-ring-label">{label}</span>
        {sub && <span className="admin-ring-sub">{sub}</span>}
      </div>
    </div>
  );
}

export function MegaStat({
  label,
  value,
  sub,
  tone = "neutral",
  trend,
  bar,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bull" | "bear" | "violet" | "cyan" | "amber" | "neutral";
  trend?: "up" | "down" | "flat";
  bar?: number;
}) {
  return (
    <div className={clsx("admin-mega-stat", `admin-mega-stat-${tone}`)}>
      <div className="admin-mega-stat-glow" aria-hidden />
      <p className="admin-mega-stat-label">{label}</p>
      <div className="admin-mega-stat-row">
        <p className="admin-mega-stat-value">{value}</p>
        {trend && (
          <span className={clsx("admin-mega-trend", `admin-mega-trend-${trend}`)}>
            {trend === "up" ? "▲" : trend === "down" ? "▼" : "—"}
          </span>
        )}
      </div>
      {sub && <p className="admin-mega-stat-sub">{sub}</p>}
      {bar != null && (
        <div className="admin-mega-bar">
          <div className="admin-mega-bar-fill" style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </div>
      )}
    </div>
  );
}

export function GlassPanel({
  title,
  children,
  className,
  accent = "bull",
  kicker,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  accent?: "bull" | "bear" | "violet" | "cyan" | "amber";
  kicker?: string;
}) {
  return (
    <section className={clsx("admin-glass admin-deck-panel admin-glass-shimmer", `admin-glass-${accent}`, className)}>
      <div className="admin-glass" aria-hidden />
      {kicker && <p className="admin-deck-kicker">{kicker}</p>}
      {title && <h3 className="admin-glass-title admin-deck-title">{title}</h3>}
      <div className="admin-glass-body">{children}</div>
    </section>
  );
}

export function LivePill({ label, active = true }: { label: string; active?: boolean }) {
  return (
    <span className={clsx("admin-live-pill", active && "admin-live-pill-on")}>
      <span className="admin-live-pill-dot" />
      {label}
    </span>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx("admin-action-btn", `admin-action-btn-${variant}`)}
    >
      {children}
    </button>
  );
}

export function TabCommandHero({
  kicker,
  title,
  titleAccent,
  subtitle,
  chips,
  rings,
  actions,
  compact = false,
}: {
  kicker: string;
  title: string;
  titleAccent?: string;
  subtitle: string;
  chips?: React.ReactNode;
  rings?: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <header
      className={clsx(
        "admin-command-hero admin-command-hero-stacked",
        compact && "admin-command-hero-compact"
      )}
    >
      <div className="admin-command-hero-left">
        <p className="admin-kicker admin-kicker-glow">{kicker}</p>
        <h1 className="admin-title admin-title-xl">
          {title}
          {titleAccent ? <> <span className="admin-title-accent">{titleAccent}</span></> : null}
        </h1>
        <p className="admin-sub admin-sub-hero">{subtitle}</p>
        {chips && <div className="admin-hero-chips">{chips}</div>}
        {actions && <div className="admin-hero-actions">{actions}</div>}
      </div>
      {rings && <div className="admin-command-rings">{rings}</div>}
    </header>
  );
}

export function MetricChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear" | "violet" | "cyan" | "amber" | "neutral";
}) {
  return (
    <div className={clsx("admin-metric-chip", `admin-metric-chip-${tone}`)}>
      <span className="admin-metric-chip-label">{label}</span>
      <span className="admin-metric-chip-value">{value}</span>
    </div>
  );
}

export function HorzBar({
  label,
  value,
  max = 1,
  tone = "bull",
  right,
}: {
  label: string;
  value: number;
  max?: number;
  tone?: "bull" | "bear" | "violet" | "cyan" | "amber";
  right?: string;
}) {
  const pctWidth = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="admin-horz-bar">
      <div className="admin-horz-bar-head">
        <span className="admin-horz-bar-label">{label}</span>
        {right && <span className="admin-horz-bar-right">{right}</span>}
      </div>
      <div className="admin-horz-bar-track">
        <div
          className={clsx("admin-horz-bar-fill", `admin-horz-bar-fill-${tone}`)}
          style={{ width: `${pctWidth}%` }}
        />
      </div>
    </div>
  );
}

export function DeckPanel({
  title,
  defaultOpen = false,
  children,
  badge,
  accent = "cyan",
  storageKey,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  accent?: "bull" | "bear" | "violet" | "cyan" | "amber";
  children: React.ReactNode;
  storageKey?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    const stored = sessionStorage.getItem(`admin-deck:${storageKey}`);
    if (stored === "open") setOpen(true);
    if (stored === "closed") setOpen(false);
  }, [storageKey]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (storageKey && typeof window !== "undefined") {
        sessionStorage.setItem(`admin-deck:${storageKey}`, next ? "open" : "closed");
      }
      return next;
    });
  };

  return (
    <div className={clsx("admin-deck-panel-wrap", `admin-deck-accent-${accent}`, open && "admin-deck-open")}>
      <div className="admin-deck-strip" aria-hidden />
      <button type="button" className="admin-deck-head" onClick={toggle}>
        <span className="admin-deck-head-title">{title}</span>
        {badge && <span className="admin-deck-badge">{badge}</span>}
        <span className="admin-deck-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="admin-deck-body">{children}</div>}
    </div>
  );
}

export function DataTable({
  children,
  tall,
  className,
}: {
  children: React.ReactNode;
  tall?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("admin-scroll-table admin-table-wrap", tall && "admin-spx-table-tall", className)}>
      <table className="admin-table admin-table-pro">{children}</table>
    </div>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const tone =
    outcome === "win" ? "bull" : outcome === "loss" ? "bear" : outcome === "breakeven" ? "amber" : "neutral";
  return <span className={clsx("admin-outcome-badge", `admin-outcome-badge-${tone}`)}>{outcome}</span>;
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="admin-filter-field">
      <span className="admin-filter-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="admin-filter-select">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterSearch({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="admin-filter-field admin-filter-field-grow">
      <span className="admin-filter-label">{label}</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="admin-filter-input"
      />
    </label>
  );
}

export function KvTiles({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="admin-kv-tiles">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="admin-kv-tile">
          <dt className="admin-kv-tile-key">{k}</dt>
          <dd className="admin-kv-tile-val">
            {v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </div>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return <pre className="admin-json-block">{JSON.stringify(value, null, 2)}</pre>;
}

export function SectionDeck({
  children,
  className,
  accent,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: "bull" | "cyan" | "violet" | "amber";
}) {
  return (
    <div className={clsx("admin-section-deck", accent && `admin-section-deck-${accent}`, className)}>
      <div className="admin-section-deck-mesh" aria-hidden />
      {children}
    </div>
  );
}

export function TabCanvas({
  theme,
  children,
}: {
  theme: "api" | "spx" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <div className={clsx("admin-tab-canvas", `admin-tab-canvas-${theme}`)}>
      <div className="admin-tab-canvas-bg" aria-hidden>
        <div className="admin-tab-canvas-grid" />
        <div className="admin-tab-canvas-orb admin-tab-canvas-orb-a" />
        <div className="admin-tab-canvas-orb admin-tab-canvas-orb-b" />
      </div>
      <div className="admin-tab-canvas-inner">{children}</div>
    </div>
  );
}

export function PnlChart({
  days,
}: {
  days: Array<{ day: string; total_pnl: number; trades: number }>;
}) {
  if (!days.length) return <p className="admin-empty-deck-hint">No daily data yet.</p>;
  const max = Math.max(...days.map((d) => Math.abs(d.total_pnl)), 1);
  return (
    <div className="admin-pnl-chart">
      {days.map((d) => {
        const h = Math.max(8, (Math.abs(d.total_pnl) / max) * 100);
        return (
          <div key={d.day} className="admin-pnl-chart-col" title={`${d.day}: ${d.trades} trades`}>
            <span className={clsx("admin-pnl-chart-val", d.total_pnl >= 0 ? "admin-td-bull" : "admin-td-bear")}>
              {d.total_pnl >= 0 ? "+" : ""}
              {d.total_pnl.toFixed(0)}
            </span>
            <div className="admin-pnl-chart-bar-wrap">
              <div
                className={clsx(
                  "admin-pnl-chart-bar",
                  d.total_pnl >= 0 ? "admin-pnl-chart-bar-up" : "admin-pnl-chart-bar-down"
                )}
                style={{ height: `${h}%` }}
              />
            </div>
            <span className="admin-pnl-chart-label">{d.day.slice(5)}</span>
            <span className="admin-pnl-chart-trades">{d.trades}t</span>
          </div>
        );
      })}
    </div>
  );
}

export function HealthMeter({
  label,
  value,
  tone = "bull",
}: {
  label: string;
  value: number;
  tone?: "bull" | "bear" | "cyan" | "amber";
}) {
  const pctVal = Math.min(100, Math.max(0, value));
  return (
    <div className="admin-health-meter">
      <div className="admin-health-meter-head">
        <span>{label}</span>
        <span>{pctVal.toFixed(0)}%</span>
      </div>
      <div className="admin-health-meter-track">
        <div
          className={clsx("admin-health-meter-fill", `admin-horz-bar-fill-${tone}`)}
          style={{ width: `${pctVal}%` }}
        />
      </div>
    </div>
  );
}

export function EmptyDeck({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="admin-empty-deck">
      <p className="admin-empty-deck-title">{title}</p>
      {hint && <p className="admin-empty-deck-hint">{hint}</p>}
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onCancel} size="sm" className="admin-confirm-modal">
      <p className="admin-confirm-kicker">Confirm action</p>
      <h3 className="admin-confirm-title">{title}</h3>
      <p className="admin-confirm-body">{body}</p>
      <div className="admin-confirm-actions">
        <ActionButton onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </ActionButton>
        <ActionButton onClick={onConfirm} disabled={loading} variant="primary">
          {loading ? "Running…" : confirmLabel}
        </ActionButton>
      </div>
    </Modal>
  );
}

export function ClaudeVerdictCard({
  verdict,
  thesis,
  source,
  approved,
}: {
  verdict: string;
  thesis?: string;
  source?: string;
  approved?: boolean;
}) {
  const isVeto = verdict === "VETO" || approved === false;
  const tone = isVeto ? "bear" : "bull";
  return (
    <div className={clsx("admin-claude-card", `admin-claude-card-${tone}`)}>
      <div className="admin-claude-card-head">
        <span className={clsx("admin-claude-badge", `admin-claude-badge-${tone}`)}>
          {isVeto ? "VETO" : "APPROVE"}
        </span>
        <span className="admin-claude-source">{source ?? "claude"}</span>
      </div>
      <p className="admin-claude-verdict">{verdict}</p>
      {thesis && <p className="admin-claude-thesis">{thesis}</p>}
    </div>
  );
}

export function ConfirmationsCard({
  passed,
  passed_count,
  total,
  checks,
}: {
  passed: boolean;
  passed_count: number;
  total: number;
  checks: Array<{ label: string; passed: boolean; required: boolean; detail: string }>;
}) {
  const tone = passed ? "bull" : "bear";
  return (
    <div className={clsx("admin-confirm-card", `admin-confirm-card-${tone}`)}>
      <div className="admin-confirm-card-head">
        <span className={clsx("admin-claude-badge", `admin-claude-badge-${tone}`)}>
          {passed_count}/{total} PASS
        </span>
        <span className="admin-claude-source">{passed ? "READY" : "BLOCKED"}</span>
      </div>
      <ul className="admin-confirm-check-list">
        {checks.map((c) => (
          <li key={c.label} className={clsx("admin-confirm-check", c.passed ? "admin-confirm-check-pass" : "admin-confirm-check-fail")}>
            <span className="admin-confirm-check-mark">{c.passed ? "✓" : "✕"}</span>
            <div>
              <p className="admin-confirm-check-label">
                {c.label}
                {c.required && <span className="admin-confirm-required">required</span>}
              </p>
              <p className="admin-confirm-check-detail">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MtfHybridCard({
  ok,
  summary,
  failure_reason,
  t1_trigger,
  t2_confirm_3m,
  t3_regime_5m,
  soft_5m,
}: {
  ok: boolean;
  summary: string;
  failure_reason: string | null;
  t1_trigger: boolean;
  t2_confirm_3m: boolean;
  t3_regime_5m: boolean;
  soft_5m: boolean;
}) {
  const tone = ok ? "bull" : "bear";
  const steps = [
    { label: "1m trigger", pass: t1_trigger },
    { label: "3m confirm", pass: t2_confirm_3m },
    { label: "5m regime", pass: t3_regime_5m },
  ];
  return (
    <div className={clsx("admin-mtf-card", `admin-mtf-card-${tone}`)}>
      <div className="admin-claude-card-head">
        <span className={clsx("admin-claude-badge", `admin-claude-badge-${tone}`)}>{ok ? "MTF OK" : "MTF FAIL"}</span>
        {soft_5m && <span className="admin-claude-source">soft 5m</span>}
      </div>
      <p className="admin-claude-thesis">{summary}</p>
      {failure_reason && <p className="admin-mtf-fail">{failure_reason}</p>}
      <div className="admin-mtf-steps">
        {steps.map((s) => (
          <span key={s.label} className={clsx("admin-mtf-step", s.pass ? "admin-mtf-step-pass" : "admin-mtf-step-fail")}>
            {s.pass ? "✓" : "✕"} {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
