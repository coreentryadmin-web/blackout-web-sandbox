"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { useGridLayout, useGridPanelScope } from "@/lib/grid/grid-layout-context";

/** Per-panel accent (Living Terminal palette). No grey anywhere. */
export type GridAccent = "emerald" | "gold" | "sky" | "violet" | "bear";

const ACCENT_HEX: Record<GridAccent, string> = {
  emerald: "#00e676",
  gold: "#ffcc4d",
  sky: "#7dd3fc",
  violet: "#bf5fff",
  bear: "#ff5c78",
};

export interface GridCardProps {
  title: string;
  /** Short uppercase tag shown left of the title (e.g. "NEWS", "FLOW"). */
  kicker?: string;
  accent?: GridAccent;
  /** true => connected/fresh (green-ish live dot pulses); false => offline/poll (dim). */
  live?: boolean;
  /** Optional right-aligned header content (filter chips, counts). */
  actions?: ReactNode;
  /** Optional footer row (filters, disclaimers). */
  footer?: ReactNode;
  /** Column span on the desktop 4-col masonry. Pulse hero = 4 (full width). Default 1. */
  span?: 1 | 2 | 4;
  className?: string;
  children: ReactNode;
}

/**
 * GridCard — the shared shell for every BlackOut Grid panel. Title row (accent bar + kicker +
 * label + live dot), themed body, optional footer. One component, themed per-panel by `accent`.
 * Brand: Living Terminal; the accent drives the top hairline + glow. No grey (bg is #040407).
 */
export function GridCard({
  title,
  kicker,
  accent = "sky",
  live = false,
  actions,
  footer,
  span = 1,
  className,
  children,
}: GridCardProps) {
  const hex = ACCENT_HEX[accent];

  // Optional board integration — present only when rendered inside GridBoard's
  // GridLayoutProvider + GridPanelScope. Outside the board these are no-ops.
  const scope = useGridPanelScope();
  const layout = useGridLayout();
  const collapsed = !!(scope && layout?.isCollapsed(scope.id));
  const controllable = !!(scope && layout);

  return (
    <section
      className={clsx("grid-card", collapsed && "grid-card--collapsed", className)}
      style={{
        ["--grid-accent" as string]: hex,
        gridColumn: span === 4 ? "1 / -1" : span === 2 ? "span 2" : undefined,
      }}
    >
      <header className="grid-card-head">
        <span className="grid-card-accent-bar" aria-hidden />
        {kicker && <span className="grid-card-kicker">{kicker}</span>}
        <h3 className="grid-card-title">{title}</h3>
        <span className="grid-card-head-spacer" />
        {!collapsed && actions}
        <span
          className={clsx("grid-card-dot", live ? "grid-card-dot-live" : "grid-card-dot-idle")}
          aria-label={live ? "Live" : "Idle"}
        />
        {controllable && (
          <div className="grid-card-ctrls">
            <button
              type="button"
              className="grid-card-ctrl"
              onClick={() => layout!.toggleCollapsed(scope!.id)}
              aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
              title={collapsed ? "Expand" : "Collapse"}
            >
              <span className={clsx("grid-card-chevron", collapsed && "grid-card-chevron--up")} aria-hidden />
            </button>
            <button
              type="button"
              className="grid-card-ctrl grid-card-ctrl--close"
              onClick={() => layout!.toggleHidden(scope!.id)}
              aria-label={`Hide ${title}`}
              title="Hide panel"
            >
              ×
            </button>
          </div>
        )}
      </header>
      {!collapsed && <div className="grid-card-body">{children}</div>}
      {!collapsed && footer && <footer className="grid-card-foot">{footer}</footer>}
    </section>
  );
}
