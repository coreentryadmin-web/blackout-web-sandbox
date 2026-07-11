"use client";

import React, { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { clsx } from "clsx";
import { useAppAuth } from "@/lib/auth-client";
import { useMergedDesk } from "@/features/spx/hooks/useMergedDesk";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { useCompactDeskPanels } from "@/hooks/useCompactDeskPanels";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";
import { EmptyState, Button } from "@/components/ui";
import { shouldShowHaltDegradedBanner } from "@/features/spx/lib/spx-halt-banner";

const SpxSniperHeader = dynamic(
  () => import("./SpxSniperHeader").then((m) => ({ default: m.SpxSniperHeader })),
  { loading: () => null }
);

const SpxGexMatrixHeatmap = dynamic(
  () => import("./SpxGexMatrixHeatmap").then((m) => ({ default: m.SpxGexMatrixHeatmap })),
  { loading: () => null }
);

const SpxTradeAlerts = dynamic(
  () => import("./SpxTradeAlerts").then((m) => ({ default: m.SpxTradeAlerts })),
  { loading: () => null }
);

const SpxCommentaryRail = dynamic(
  () => import("./SpxCommentaryRail").then((m) => ({ default: m.SpxCommentaryRail })),
  { loading: () => null }
);

const SpxLiveSpotPrice = dynamic(
  () => import("./SpxLiveSpotPrice").then((m) => ({ default: m.SpxLiveSpotPrice })),
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

export function SpxDashboard() {
  const { isLoaded, tier } = useAppAuth();
  const { desk, live, refreshing, deskLoading, sessionActive } = useMergedDesk();
  const nativeShell = useIosNativeShell();
  const compactPanels = useCompactDeskPanels(nativeShell);
  const [iosPanel, setIosPanel] = useState<"plays" | "matrix" | "intel">("plays");

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

      {compactPanels && (
        <IosNativeSegment
          value={iosPanel}
          onChange={setIosPanel}
          accent="#00e676"
          aria-label="SPX desk view"
          className="ios-native-desk-segment"
          segments={[
            { id: "plays", label: "Plays" },
            { id: "matrix", label: "Matrix" },
            { id: "intel", label: "Intel" },
          ]}
        />
      )}

      {/*
        Four grid slots: Largo | Matrix | Plays (kanban) | Terminal.
        SpxTradeAlerts returns a Fragment (plays + terminal) so both become real
        grid children — avoid display:contents wrappers (unreliable with grid-areas).
      */}
      <div
        className="spx-sniper-triple spx-sniper-triple--desk-v2"
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
              <SpxCommentaryRail desk={desk} live={live} />
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
            {(!compactPanels || iosPanel === "matrix") && (
              <div className="spx-matrix-column-spot shrink-0" aria-label="SPX live spot">
                <SpxLiveSpotPrice desk={desk} live={live} size="panel" />
              </div>
            )}
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
            />
          </aside>
        </SpxPanelErrorBoundary>

        <SpxPanelErrorBoundary>
          <SpxTradeAlerts
            desk={desk}
            live={live}
            refreshing={refreshing}
            sessionActive={sessionActive}
            iosHidden={Boolean(compactPanels && iosPanel !== "plays")}
          />
        </SpxPanelErrorBoundary>
      </div>
    </div>
  );
}
