"use client";

import { clsx } from "clsx";
import type { AgentFilterField } from "@/features/nighthawk/lib/agent-config";

export function AgentFilterFieldControl({
  field,
  value,
  onChange,
}: {
  field: AgentFilterField;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}) {
  if (field.type === "toggle") {
    const on = Boolean(value);
    return (
      <label className="nighthawk-filter-toggle">
        <span className="nighthawk-filter-label">{field.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={clsx("nighthawk-toggle", on && "nighthawk-toggle-on")}
          onClick={() => onChange(!on)}
        >
          <span className="nighthawk-toggle-thumb" />
        </button>
        {field.hint && <span className="nighthawk-filter-hint">{field.hint}</span>}
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="nighthawk-filter-field">
        <span className="nighthawk-filter-label">{field.label}</span>
        <select
          className="nighthawk-filter-input"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {field.hint && <span className="nighthawk-filter-hint">{field.hint}</span>}
      </label>
    );
  }

  return (
    <label className="nighthawk-filter-field">
      <span className="nighthawk-filter-label">{field.label}</span>
      <input
        type={field.type === "number" ? "number" : "text"}
        className="nighthawk-filter-input"
        placeholder={field.placeholder}
        value={String(value)}
        onChange={(e) => onChange(field.type === "number" ? Number(e.target.value) : e.target.value)}
      />
      {field.hint && <span className="nighthawk-filter-hint">{field.hint}</span>}
    </label>
  );
}
