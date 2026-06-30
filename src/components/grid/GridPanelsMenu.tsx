"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { useGridLayout } from "@/lib/grid/grid-layout-context";

export interface GridPanelMeta {
  id: string;
  title: string;
}

/**
 * GridPanelsMenu — board toolbar control. A dropdown listing every panel with a
 * show/hide toggle, plus collapse-all / expand-all / reset. Persists via the
 * GridLayout context (localStorage). Closes on outside-click / Escape.
 */
export function GridPanelsMenu({ panels }: { panels: GridPanelMeta[] }) {
  const layout = useGridLayout();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!layout) return null;
  const hiddenCount = layout.hideCount;
  const allIds = panels.map((p) => p.id);

  return (
    <div className="grid-menu" ref={ref}>
      <button
        type="button"
        className={clsx("grid-menu-btn", open && "grid-menu-btn--open")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="grid-menu-glyph" aria-hidden>
          <span /><span /><span /><span />
        </span>
        Panels
        {hiddenCount > 0 && <span className="grid-menu-badge">{panels.length - hiddenCount}/{panels.length}</span>}
      </button>

      {open && (
        <div className="grid-menu-pop" role="menu">
          <div className="grid-menu-pop-head">
            <span>Board panels</span>
            <button type="button" className="grid-menu-reset" onClick={layout.reset}>
              Reset
            </button>
          </div>
          <div className="grid-menu-actions">
            <button type="button" onClick={() => layout.collapseAll(allIds)}>Collapse all</button>
            <button type="button" onClick={layout.expandAll}>Expand all</button>
          </div>
          <ul className="grid-menu-list">
            {panels.map((p) => {
              const visible = !layout.isHidden(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={visible}
                    className={clsx("grid-menu-item", !visible && "grid-menu-item--off")}
                    onClick={() => layout.toggleHidden(p.id)}
                  >
                    <span className={clsx("grid-menu-check", visible && "grid-menu-check--on")} aria-hidden>
                      {visible ? "✓" : ""}
                    </span>
                    {p.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
