"use client";

import { clsx } from "clsx";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { GridPageTabs } from "@/components/zerodte/GridPageTabs";
import { GridTickerProvider } from "@/lib/grid/grid-ticker-context";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

type Props = {
  showZeroDteCommand: boolean;
};

/** /grid page frame — tabs-first on native shell. */
export function GridPageShell({ showZeroDteCommand }: Props) {
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
              kicker={showZeroDteCommand ? "Always-on 0DTE hunter" : "Cross-market recon"}
              title={showZeroDteCommand ? "0DTE Command" : "Market Grid"}
              subtitle={
                showZeroDteCommand
                  ? "Runs all session finding new 0DTE plays — fresh names only, every find logged and graded."
                  : "Unified news, flow, movers, macro, and dealer positioning — one ticker-scoped command surface."
              }
              badge={<ProductMark product="grid" size={44} />}
            />
          )}
          <div className={clsx(nativeShell ? "mt-0" : "mt-5")}>
            <GridPageTabs showZeroDteCommand={showZeroDteCommand} />
          </div>
        </GridTickerProvider>
      </div>
    </PageShell>
  );
}
