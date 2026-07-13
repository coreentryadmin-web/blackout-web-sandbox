"use client";

import { useState } from "react";
import type { AlertRule, AlertKind, FiredAlert } from "@/features/vector/lib/vector-alerts";

type Props = {
  ticker: string;
  rules: AlertRule[];
  /** Recent fired alerts (newest first) for the small in-panel history. */
  recent: FiredAlert[];
  onAdd: (kind: AlertKind, tolerancePct?: number) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
};

const KIND_LABEL: Record<AlertKind, string> = {
  "wall-touch": "Wall touch",
  "flip-cross": "Flip cross",
};

/**
 * Minimal per-ticker alert rule definer + recent-fires history (in-page delivery, slice 1b). The
 * member adds wall-touch / flip-cross rules; the chart evaluates them on each live tick and fired
 * alerts surface here + as a toast + in the desk terminal. Rules persist to localStorage (handled by
 * the shell) so they survive reloads. Purely presentational — all state lives in the shell.
 */
export function VectorAlertsPanel({ ticker, rules, recent, onAdd, onToggle, onRemove }: Props) {
  const [kind, setKind] = useState<AlertKind>("wall-touch");
  const [tol, setTol] = useState<string>("0.1");

  const add = () => {
    const pct = kind === "wall-touch" ? Math.max(0.01, Number(tol) || 0.1) / 100 : undefined;
    onAdd(kind, pct);
  };

  return (
    <section className="vector-alerts-panel" aria-label={`${ticker} alerts`}>
      <header className="vector-alerts-head">
        <span className="vector-alerts-title">Alerts</span>
        <span className="vector-alerts-sub">{ticker} · price hits wall / crosses flip</span>
      </header>

      <div className="vector-alerts-add">
        <select
          className="vector-alerts-select"
          value={kind}
          onChange={(e) => setKind(e.target.value as AlertKind)}
          aria-label="Alert type"
        >
          <option value="wall-touch">Wall touch</option>
          <option value="flip-cross">Flip cross</option>
        </select>
        {kind === "wall-touch" && (
          <label className="vector-alerts-tol">
            <input
              className="vector-alerts-tol-input"
              type="number"
              min="0.01"
              step="0.05"
              value={tol}
              onChange={(e) => setTol(e.target.value)}
              aria-label="Tolerance percent"
            />
            <span className="vector-alerts-tol-unit">%</span>
          </label>
        )}
        <button type="button" className="vector-alerts-addbtn" onClick={add}>
          + Add
        </button>
      </div>

      {rules.length === 0 ? (
        <p className="vector-alerts-empty">No alerts yet — add one above.</p>
      ) : (
        <ul className="vector-alerts-list">
          {rules.map((r) => (
            <li key={r.id} className="vector-alerts-rule">
              <button
                type="button"
                className={`vector-alerts-toggle ${r.enabled ? "on" : "off"}`}
                onClick={() => onToggle(r.id)}
                aria-pressed={r.enabled}
                aria-label={`${r.enabled ? "Disable" : "Enable"} ${KIND_LABEL[r.kind]}`}
              >
                {r.enabled ? "●" : "○"}
              </button>
              <span className="vector-alerts-rule-label">
                {KIND_LABEL[r.kind]}
                {r.kind === "wall-touch" && r.tolerancePct != null
                  ? ` · ${(r.tolerancePct * 100).toFixed(2)}%`
                  : ""}
              </span>
              <button
                type="button"
                className="vector-alerts-remove"
                onClick={() => onRemove(r.id)}
                aria-label={`Remove ${KIND_LABEL[r.kind]}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {recent.length > 0 && (
        <div className="vector-alerts-recent">
          <span className="vector-alerts-recent-title">Recent</span>
          <ul className="vector-alerts-recent-list">
            {recent.slice(0, 4).map((f) => (
              <li key={`${f.ruleId}:${f.at}`} className="vector-alerts-recent-item">
                {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
