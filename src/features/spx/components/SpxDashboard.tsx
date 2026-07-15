"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { clsx } from "clsx";
import { useAppAuth } from "@/lib/auth-client";
import { useMergedDesk } from "@/features/spx/hooks/useMergedDesk";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { useCompactDeskPanels } from "@/hooks/useCompactDeskPanels";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";
import { EmptyState, Button } from "@/components/ui";
import { shouldShowHaltDegradedBanner } from "@/features/spx/lib/spx-halt-banner";
import {
  SPX_DESK_FOCUS_STORAGE_KEY,
  focusHotkeyAction,
  nextFocusState,
} from "@/features/spx/lib/spx-desk-focus";
// Type-only: VectorSeedProps comes from a server-only module; the type import is erased at build.
import type { VectorSeedProps } from "@/features/vector";
// Type-only: the shared-price-axis map the embedded chart emits (see vector-price-scale-map.ts).
import type { VectorPriceScaleMap } from "@/features/vector/lib/vector-price-scale-map";

const SpxSniperHeader = dynamic(
  () => import("./SpxSniperHeader").then((m) => ({ default: m.SpxSniperHeader })),
  { loading: () => null }
);

const SpxGexMatrixHeatmap = dynamic(
  () => import("./SpxGexMatrixHeatmap").then((m) => ({ default: m.SpxGexMatrixHeatmap })),
  { loading: () => null }
);

// DESK CONSOLIDATION (2026-07-13, member-directed): the Trade Alerts panel (plays kanban +
// engine cards) and the Slayer desk terminal (mounted inside that same component) are
// REMOVED from the flagship desk in favour of the embedded SPX Vector chart below — one
// flagship desk, one source of truth, and explicitly NO terminal panels on SPX Slayer. The
// components stay in the repo untouched (see ./SpxTradeAlerts.tsx) so restoring them is one
// render away if the member reverses the call.
const VectorPageShell = dynamic(
  () =>
    import("@/features/vector/components/VectorPageShell").then((m) => ({
      default: m.VectorPageShell,
    })),
  { loading: () => null }
);

const SpxCommentaryRail = dynamic(
  () => import("./SpxCommentaryRail").then((m) => ({ default: m.SpxCommentaryRail })),
  { loading: () => null }
);

class SpxPanelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError)
      return (
        <div className="text-bear p-4 text-xs font-mono">
          Panel unavailable — reload the page to reconnect.
        </div>
      );
    return this.props.children;
  }
}

type SpxDashboardProps = {
  /**
   * SSR seed for the embedded SPX Vector chart (loaded by the /dashboard server page via the
   * SAME loadVectorSeedProps helper the /vector page uses — one code path, zero drift). Null when
   * the vector tool is not accessible to this user (launch-gated) — the desk then shows a
   * launching-soon note in that column instead of a broken chart hitting 403 APIs.
   */
  vectorSeed: VectorSeedProps | null;
};

export function SpxDashboard({ vectorSeed }: SpxDashboardProps) {
  const { isLoaded, tier } = useAppAuth();
  const { desk, live, deskLoading, deskLaneFailed, sessionActive } = useMergedDesk();
  const nativeShell = useIosNativeShell();
  const compactPanels = useCompactDeskPanels(nativeShell);
  const [iosPanel, setIosPanel] = useState<"vector" | "matrix" | "intel">("vector");

  // SHARED PRICE AXIS (2026-07-13): the embedded Vector chart reports its live y-mapping
  // through the VectorPageShell seam; the matrix column's ladder view consumes it so bars
  // and the spot line land at the SAME pixel heights as the chart.
  const [priceScaleMap, setPriceScaleMap] = useState<VectorPriceScaleMap | null>(null);

  // FOCUS MODE (2026-07-13): `F` toggles / `Esc` exits (ignored while typing), persisted
  // per device. Hydrated after mount so SSR markup is deterministic. Compact/iOS shells
  // keep the segmented layout — focus is a desktop-grid concept.
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    try {
      setFocusMode(window.localStorage.getItem(SPX_DESK_FOCUS_STORAGE_KEY) === "1");
    } catch {
      /* storage unavailable — default expanded */
    }
  }, []);
  const applyFocus = useCallback((updater: (cur: boolean) => boolean) => {
    setFocusMode((cur) => {
      const next = updater(cur);
      if (next !== cur) {
        try {
          window.localStorage.setItem(SPX_DESK_FOCUS_STORAGE_KEY, next ? "1" : "0");
        } catch {
          /* best-effort persistence */
        }
      }
      return next;
    });
  }, []);
  const toggleFocus = useCallback(() => applyFocus((cur) => !cur), [applyFocus]);
  useEffect(() => {
    if (compactPanels) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      // setFocusMode's functional form reads the CURRENT value, but the Escape decision
      // needs it BEFORE the reducer runs — resolve the action inside the updater instead.
      applyFocus((cur) => {
        const action = focusHotkeyAction(e, target, cur);
        return nextFocusState(cur, action);
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compactPanels, applyFocus]);
  const focusActive = focusMode && !compactPanels;

  if (isLoaded && tier && tier !== "premium" && tier !== "admin") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <EmptyState
          title="Premium membership required"
          description={
            <>
              <span className="hide-in-ios-app">
                This account does not have an active Premium membership. Upgrade to access the
                live desk.
              </span>
              <span className="show-in-ios-app">
                This account does not have an active Premium membership. Membership is managed
                on the web.
              </span>
            </>
          }
          action={
            <>
              <Button href="/upgrade" variant="primary" size="sm" className="hide-in-ios-app">
                Unlock Premium
              </Button>
              <Button href="/upgrade" variant="primary" size="sm" className="show-in-ios-app">
                Check membership
              </Button>
            </>
          }
          className="max-w-md"
        />
      </div>
    );
  }

  if (deskLoading && !desk) {
    return (
      <div className="spx-sniper-desk spx-sniper-desk-loading" aria-busy="true">
        <div className="spx-desk-placeholder" />
      </div>
    );
  }

  const activeHalts = desk?.active_halts ?? [];
  const haltChannelStale = desk?.halt_channel_stale ?? false;
  const showHaltDegradedBanner = shouldShowHaltDegradedBanner({
    sessionActive,
    haltChannelStale,
    activeHaltsCount: activeHalts.length,
  });

  return (
    <div className="spx-sniper-desk spx-sniper-desk-fill">
      {deskLaneFailed && (
        <div
          className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-mono text-amber-200"
          role="alert"
        >
          Desk rebuild failed — showing last cached snapshot. Retrying in the background.
        </div>
      )}
      {activeHalts.length > 0 && (
        <div
          className="flex items-center gap-2 rounded border border-bear/40 bg-bear/10 px-4 py-2 text-xs font-mono text-bear"
          role="alert"
        >
          <span className="font-bold">TRADING HALT</span>
          {activeHalts.map((h) => (
            <span key={h.symbol}>
              {h.symbol}
              {h.halt_type ? ` · ${h.halt_type}` : ""}
              {h.reason ? ` — ${h.reason}` : ""}
            </span>
          ))}
        </div>
      )}
      {showHaltDegradedBanner && (
        <div
          className="flex items-center gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs font-mono text-amber-400"
          role="alert"
        >
          <span>Halt feed degraded — restricted entry mode; verify no active halts before entering</span>
        </div>
      )}
      <SpxPanelErrorBoundary>
        <SpxSniperHeader desk={desk} live={live} nativeShell={nativeShell} />
      </SpxPanelErrorBoundary>

      {/* SESSION TIME BAR removed (user-directed 2026-07-14): the strip cost a row of panel
          height for information the ribbon/banner already carry. Component stays in the repo;
          the focus toggle it hosted now lives in the Vector toolbar, left of Replay. */}
      {compactPanels && (
        <IosNativeSegment
          value={iosPanel}
          onChange={setIosPanel}
          accent="#00e676"
          aria-label="SPX desk view"
          className="ios-native-desk-segment"
          segments={[
            { id: "vector", label: "Vector" },
            { id: "matrix", label: "Matrix" },
            { id: "intel", label: "Intel" },
          ]}
        />
      )}

      {/*
        Three grid slots (desk v3, 2026-07-13 member-directed consolidation):
        Largo commentary | Matrix | embedded SPX Vector chart (chart-only, no terminal).
        The former Plays (kanban) and Terminal columns were removed in favour of the Vector
        chart — the components remain in the repo unused so a reversal is one render away.
      */}
      {/* --desk-v2 keeps the shared rail styling (gap, borders, Largo/matrix columns);
          --desk-v3 swaps the grid template from four rails to three and adds the vector column. */}
      <div
        className={clsx(
          "spx-sniper-triple spx-sniper-triple--desk-v2 spx-sniper-triple--desk-v3",
          focusActive && "spx-sniper-triple--focus"
        )}
        data-ios-panel={compactPanels ? iosPanel : undefined}
      >
        <SpxPanelErrorBoundary>
          <Suspense fallback={null}>
            <aside
              className={clsx(
                "spx-sniper-intel-col spx-left-commentary",
                compactPanels && iosPanel !== "intel" && "ios-native-panel-hidden",
                compactPanels && iosPanel === "intel" && "ios-native-panel-visible"
              )}
            >
              <SpxCommentaryRail desk={desk} live={live} focus={focusActive} />
            </aside>
          </Suspense>
        </SpxPanelErrorBoundary>

        <SpxPanelErrorBoundary>
          <aside
            className={clsx(
              "spx-sniper-left-rail spx-left-matrix",
              compactPanels && iosPanel !== "matrix" && "ios-native-panel-hidden",
              compactPanels && iosPanel === "matrix" && "ios-native-panel-visible"
            )}
          >
            {/* Spot module removed from this column (user-directed 2026-07-14): spot now lives
                in the header ribbon left of EMA, and the Dealer Gamma Map gets the full column
                height — same as the other two panels. */}
            <SpxGexMatrixHeatmap
              live={live}
              sessionActive={sessionActive}
              liveSpot={desk?.price ?? null}
              deskGammaFlip={desk?.gamma_flip ?? null}
              deskGexKing={desk?.gex_king ?? null}
              gexStale={desk?.gex_stale}
              openingRange={desk?.opening_range ?? null}
              unifiedTape={desk?.unified_tape}
              flow0dteNet={desk?.flow_0dte_net}
              flow0dteCallPrem={desk?.flow_0dte_call_premium}
              flow0dtePutPrem={desk?.flow_0dte_put_premium}
              priceScaleMap={priceScaleMap}
              focus={focusActive}
            />
          </aside>
        </SpxPanelErrorBoundary>

        <SpxPanelErrorBoundary>
          <section
            className={clsx(
              "spx-sniper-vector-col",
              compactPanels && iosPanel !== "vector" && "ios-native-panel-hidden",
              compactPanels && iosPanel === "vector" && "ios-native-panel-visible"
            )}
            aria-label="SPX Vector chart"
          >
            {vectorSeed ? (
              // The FULL Vector chart surface (toolbar, DTE toggle, indicators, regime banner,
              // alert toasts) pinned to SPX — same component + same server seed path as /vector.
              // Desk defaults per member direction: 0DTE horizon, 3-minute candles.
              <VectorPageShell
                {...vectorSeed}
                embed="chart-only"
                defaultDteHorizon="0dte"
                defaultTimeframe={3}
                onPriceScaleRender={setPriceScaleMap}
                toolbarReplayLeadSlot={
                  // Focus toggle relocated here from the removed session time bar
                  // (user-directed 2026-07-14: "move Focus to left of Replay").
                  !compactPanels ? (
                    <button
                      type="button"
                      id="spx-desk-focus-toggle"
                      className={clsx("spx-desk-focus-btn", focusActive && "spx-desk-focus-btn--active")}
                      onClick={toggleFocus}
                      aria-pressed={focusActive}
                      title={focusActive ? "Exit focus mode (F or Esc)" : "Focus mode — chart fills the desk (F)"}
                    >
                      ⛶ Focus
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState
                title="Vector chart launching soon"
                description="The embedded SPX Vector chart is not enabled for this account yet."
                className="m-auto max-w-md"
              />
            )}
          </section>
        </SpxPanelErrorBoundary>
      </div>
    </div>
  );
}
