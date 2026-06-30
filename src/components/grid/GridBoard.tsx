"use client";

import type { ReactNode } from "react";
import { PulseStrip } from "./PulseStrip";
import { GridNewsPanel } from "./GridNewsPanel";
import { GridFlowPanel } from "./GridFlowPanel";
import { AnalystActions } from "./AnalystActions";
import { GridMoversPanel } from "./GridMoversPanel";
import { GridEarningsPanel } from "./GridEarningsPanel";
import { GridDarkPoolPanel } from "./GridDarkPoolPanel";
import { GridCongressPanel } from "./GridCongressPanel";
import { GridEconomyPanel } from "./GridEconomyPanel";
import { GridCatalystsPanel } from "./GridCatalystsPanel";
import { GridGexPanel } from "./GridGexPanel";
import { GridSectorsPanel } from "./GridSectorsPanel";
import { GridPanelsMenu, type GridPanelMeta } from "./GridPanelsMenu";
import {
  GridLayoutProvider,
  GridPanelScope,
  useGridLayout,
} from "@/lib/grid/grid-layout-context";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";
import { GridBootstrapPrefetch } from "./GridBootstrapPrefetch";
import { SWRConfig } from "swr";

/**
 * Panel registry — single source of truth for the board. `id` drives
 * visibility/collapse persistence + the Panels menu; `node` is the panel itself
 * (each renders its own GridCard). Order = on-screen order.
 */
const PANELS: { id: string; title: string; node: ReactNode }[] = [
  { id: "pulse", title: "Market Pulse", node: <PulseStrip /> },
  { id: "news", title: "Unified News", node: <GridNewsPanel /> },
  { id: "flow", title: "Notable Flow", node: <GridFlowPanel /> },
  { id: "analysts", title: "Analyst Actions", node: <AnalystActions /> },
  { id: "gex", title: "GEX Regime", node: <GridGexPanel /> },
  { id: "movers", title: "Top Movers", node: <GridMoversPanel /> },
  { id: "earnings", title: "Earnings Radar", node: <GridEarningsPanel /> },
  { id: "darkpool", title: "Dark Pool", node: <GridDarkPoolPanel /> },
  { id: "congress", title: "Congress Trades", node: <GridCongressPanel /> },
  { id: "economy", title: "Macro Indicators", node: <GridEconomyPanel /> },
  { id: "catalysts", title: "Corporate Catalysts", node: <GridCatalystsPanel /> },
  { id: "sectors", title: "Sector Heat", node: <GridSectorsPanel /> },
];

const PANEL_META: GridPanelMeta[] = PANELS.map(({ id, title }) => ({ id, title }));

/** Full-width active-ticker banner. */
function GridBanner() {
  const { ticker, isFiltered, setTicker } = useGridTicker();
  if (!isFiltered || !ticker) return null;
  return (
    <div className="grid-banner">
      <span className="grid-banner-dot" aria-hidden />
      <span className="grid-banner-text">
        Showing all data for <span className="grid-banner-ticker">{ticker}</span>
        <span className="grid-banner-sep"> · </span>
        <span className="grid-banner-live">Updated live</span>
      </span>
      <button type="button" onClick={() => setTicker(null)} className="grid-banner-clear" aria-label="Clear ticker filter">
        ×&nbsp;Clear
      </button>
    </div>
  );
}

/** Board toolbar — Panels menu + visible count. */
function GridToolbar() {
  const layout = useGridLayout();
  const visible = PANELS.length - (layout?.hideCount ?? 0);
  return (
    <div className="grid-toolbar">
      <span className="grid-toolbar-label">
        <span className="grid-toolbar-count">{visible}</span> of {PANELS.length} panels
      </span>
      <div className="grid-toolbar-spacer" />
      <GridPanelsMenu panels={PANEL_META} />
    </div>
  );
}

/** Renders the masonry, skipping hidden panels; each card wrapped in its scope. */
function GridDeck() {
  const layout = useGridLayout();
  return (
    <div className="grid-board">
      {PANELS.map(({ id, title, node }) =>
        layout?.isHidden(id) ? null : (
          <GridPanelScope key={id} id={id} title={title}>
            {node}
          </GridPanelScope>
        )
      )}
    </div>
  );
}

/**
 * GridBoard — the BlackOut Grid masonry. Full-bleed, immersive board with a
 * living grid backdrop (mounted by the page), collapsible/hideable panels (the
 * Panels menu + per-card controls, persisted), and staggered entrance motion.
 */
export function GridBoard() {
  return (
    <SWRConfig value={{ revalidateOnFocus: true }}>
      <GridLayoutProvider>
        <GridBootstrapPrefetch />
        <GridBanner />
        <GridToolbar />
        <GridDeck />
      </GridLayoutProvider>
    </SWRConfig>
  );
}
