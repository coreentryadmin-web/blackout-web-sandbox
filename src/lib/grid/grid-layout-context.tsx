"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Grid layout state — which panels are hidden / collapsed, persisted to
 * localStorage so a trader's board survives reloads. SSR-safe: starts empty,
 * hydrates from storage in an effect (so server + first client render match).
 */

const STORAGE_KEY = "blackout:grid:layout:v1";

type LayoutState = { hidden: string[]; collapsed: string[] };

interface GridLayoutValue {
  isHidden: (id: string) => boolean;
  isCollapsed: (id: string) => boolean;
  toggleHidden: (id: string) => void;
  toggleCollapsed: (id: string) => void;
  show: (id: string) => void;
  hideCount: number;
  collapseAll: (ids: string[]) => void;
  expandAll: () => void;
  reset: () => void;
}

const GridLayoutContext = createContext<GridLayoutValue | null>(null);

export function GridLayoutProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from storage once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LayoutState;
        setHidden(new Set(parsed.hidden ?? []));
        setCollapsed(new Set(parsed.collapsed ?? []));
      }
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  // Persist after hydration (avoid clobbering storage with the empty initial state).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ hidden: [...hidden], collapsed: [...collapsed] } satisfies LayoutState)
      );
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [hidden, collapsed, hydrated]);

  const toggleHidden = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const show = useCallback((id: string) => {
    setHidden((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback((ids: string[]) => setCollapsed(new Set(ids)), []);
  const expandAll = useCallback(() => setCollapsed(new Set()), []);
  const reset = useCallback(() => {
    setHidden(new Set());
    setCollapsed(new Set());
  }, []);

  const value = useMemo<GridLayoutValue>(
    () => ({
      isHidden: (id) => hidden.has(id),
      isCollapsed: (id) => collapsed.has(id),
      toggleHidden,
      toggleCollapsed,
      show,
      hideCount: hidden.size,
      collapseAll,
      expandAll,
      reset,
    }),
    [hidden, collapsed, toggleHidden, toggleCollapsed, show, collapseAll, expandAll, reset]
  );

  return <GridLayoutContext.Provider value={value}>{children}</GridLayoutContext.Provider>;
}

export function useGridLayout(): GridLayoutValue | null {
  return useContext(GridLayoutContext);
}

/**
 * Per-panel scope — lets a GridCard deep in the tree know its own id/title without
 * every panel component having to thread props. GridBoard wraps each panel in this.
 */
const GridPanelScopeContext = createContext<{ id: string; title: string } | null>(null);

export function GridPanelScope({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ id, title }), [id, title]);
  return <GridPanelScopeContext.Provider value={value}>{children}</GridPanelScopeContext.Provider>;
}

export function useGridPanelScope() {
  return useContext(GridPanelScopeContext);
}
