"use client";

import React from "react";
import { useUser } from "@clerk/nextjs";
import { useMergedDesk } from "@/hooks/useMergedDesk";
import { SpxSniperHeader } from "@/components/desk/SpxSniperHeader";
import { SpxCommentaryRail } from "@/components/desk/SpxCommentaryRail";
import { SpxTradeAlerts } from "@/components/desk/SpxTradeAlerts";
import { SpxGexMatrixHeatmap } from "@/components/desk/SpxGexMatrixHeatmap";
import { EmptyState, Button } from "@/components/ui";
import { shouldShowHaltDegradedBanner } from "@/lib/spx-halt-banner";

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
  const { isLoaded, user } = useUser();
  const tier = (user?.publicMetadata as { tier?: string } | undefined)?.tier;
  const { desk, live, refreshing, deskLoading, sessionActive } = useMergedDesk();

  if (isLoaded && tier && tier !== "premium" && tier !== "admin") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <EmptyState
          title="Premium membership required"
          description={
            <>
              {/* App Store guideline 3.1.1 — no purchase-flow language inside the iOS app.
                  Both spans render on the server (no hydration mismatch); CSS picks one based
                  on the `ios-app` <html> class set by layout.tsx's user-agent check. */}
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
        <div className="spx-desk-skeleton" />
      </div>
    );
  }

  const activeHalts = desk?.active_halts ?? [];
  const haltChannelStale = desk?.halt_channel_stale ?? false;
  // The play gate (spx-play-gates.ts) fails OPEN on a stale channel -- it only
  // warns, never blocks -- so this banner must never claim entries are
  // blocked. Also gated on sessionActive: the channel is event-only and reads
  // "stale" off-hours/holidays by design, which is not a real degradation.
  const showHaltDegradedBanner = shouldShowHaltDegradedBanner({
    sessionActive,
    haltChannelStale,
    activeHaltsCount: activeHalts.length,
  });

  return (
    <div className="spx-sniper-desk">
      {activeHalts.length > 0 && (
        <div className="flex items-center gap-2 rounded border border-bear/40 bg-bear/10 px-4 py-2 text-xs font-mono text-bear" role="alert">
          <span className="font-bold">TRADING HALT</span>
          {activeHalts.map((h) => (
            <span key={h.symbol}>
              {h.symbol}{h.halt_type ? ` · ${h.halt_type}` : ""}{h.reason ? ` — ${h.reason}` : ""}
            </span>
          ))}
        </div>
      )}
      {showHaltDegradedBanner && (
        <div className="flex items-center gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs font-mono text-amber-400" role="alert">
          <span>Halt feed degraded — proceeding fail-open; verify no active halts before entering</span>
        </div>
      )}
      <SpxPanelErrorBoundary>
        <SpxSniperHeader desk={desk} live={live} />
      </SpxPanelErrorBoundary>

      <div className="spx-sniper-triple">
        <SpxPanelErrorBoundary>
          <aside className="spx-sniper-left-rail spx-left-matrix">
            <SpxGexMatrixHeatmap
              live={live}
              liveSpot={desk?.price ?? null}
              deskGammaFlip={desk?.gamma_flip ?? null}
              deskGexKing={desk?.gex_king ?? null}
              gexStale={desk?.gex_stale}
            />
          </aside>
        </SpxPanelErrorBoundary>

        <SpxPanelErrorBoundary>
          <div className="spx-sniper-chart-col spx-center-stack">
            <SpxTradeAlerts desk={desk} live={live} refreshing={refreshing} sessionActive={sessionActive} />
          </div>
        </SpxPanelErrorBoundary>

        <SpxPanelErrorBoundary>
          <SpxCommentaryRail desk={desk} live={live} />
        </SpxPanelErrorBoundary>
      </div>
    </div>
  );
}
