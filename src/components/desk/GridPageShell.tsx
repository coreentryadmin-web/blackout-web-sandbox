"use client";

import { clsx } from "clsx";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { GridPageTabs } from "@/components/zerodte/GridPageTabs";
import { GridTickerProvider } from "@/lib/grid/grid-ticker-context";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

/** /grid page frame — the classic Market Grid board (0DTE Command moved to /nighthawk). */
export function GridPageShell() {
  const nativeShell = useIosNativeShell();

  return (
    <PageShell
      fullBleed
      className={clsx(
        "ios-native-page ios-native-page-grid grid-page-shell",
        nativeShell && "grid-page-shell-native"
      )}
      contentClassName={clsx(nativeShell ? "grid-page-content-native !py-0" : undefined)}
    >
      <div
        className={clsx(
          nativeShell ? "grid-page-inner-native px-0" : "px-2 sm:px-4 xl:px-6"
        )}
      >
        <GridTickerProvider>
          {!nativeShell && (
            <PageHeader
              kicker="Cross-market recon"
              title="Market Grid"
              subtitle="Unified news, flow, movers, macro, and dealer positioning — one ticker-scoped command surface."
              badge={<ProductMark product="grid" size={44} />}
            />
          )}
          <div className={clsx(nativeShell ? "mt-0" : "mt-5")}>
            <GridPageTabs />
          </div>
        </GridTickerProvider>
      </div>
    </PageShell>
  );
}
