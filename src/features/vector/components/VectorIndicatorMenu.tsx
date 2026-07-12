"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  VECTOR_OVERLAYS,
  type VectorOverlayId,
} from "@/features/vector/lib/vector-indicators-config";

type Props = {
  enabled: Set<VectorOverlayId>;
  onToggle: (id: VectorOverlayId) => void;
  onClear: () => void;
};

/**
 * Indicator toggle menu — a compact dropdown of the price-pane overlays (VWAP / EMAs / SMAs), all
 * OFF by default. The member opts each one in; enabled indicators show a coloured dot matching the
 * on-chart line. Closes on outside-click / Escape. Oscillators (RSI/MACD) and profiles land in
 * follow-ups and slot into this same menu.
 */
export function VectorIndicatorMenu({ enabled, onToggle, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = enabled.size;

  return (
    <div className="vector-ind-menu" ref={rootRef}>
      <button
        type="button"
        className={clsx("vector-ind-trigger", count > 0 && "vector-ind-trigger-active")}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="vector-indicator-trigger"
      >
        Indicators
        {count > 0 ? <span className="vector-ind-badge">{count}</span> : null}
      </button>

      {open ? (
        <div className="vector-ind-panel" role="menu">
          <div className="vector-ind-panel-head">
            <span>Moving averages</span>
            {count > 0 ? (
              <button type="button" className="vector-ind-clear" onClick={onClear}>
                Clear
              </button>
            ) : null}
          </div>
          {VECTOR_OVERLAYS.map((o) => {
            const on = enabled.has(o.id);
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                className={clsx("vector-ind-item", on && "vector-ind-item-on")}
                onClick={() => onToggle(o.id)}
              >
                <span
                  className="vector-ind-dot"
                  style={{ backgroundColor: on ? o.color : "transparent", borderColor: o.color }}
                  aria-hidden="true"
                />
                <span className="vector-ind-label">{o.label}</span>
                <span className="vector-ind-check" aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
