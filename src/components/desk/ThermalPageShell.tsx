"use client";

import { clsx } from "clsx";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { Heatmap } from "@/components/Heatmap";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

/** /heatmap page frame — full desk on web; compact native iOS shell. */
export function ThermalPageShell() {
  const nativeShell = useIosNativeShell();

  return (
    <PageShell
      fullBleed
      className={clsx(
        "ios-native-page ios-native-page-thermal thermal-page-shell",
        nativeShell && "thermal-page-shell-native"
      )}
      contentClassName={clsx(
        nativeShell ? "thermal-page-content-native !py-0" : "!py-6 md:!py-8"
      )}
    >
      <div
        className={clsx(
          "thermal-page-inner",
          nativeShell ? "thermal-page-inner-native" : "px-4 md:px-6"
        )}
      >
        {!nativeShell && (
          <PageHeader
            kicker="Dealer positioning"
            title="BlackOut Thermal"
            subtitle="Dealer gamma & vanna exposure"
            badge={<ProductMark product="heatmap" size={44} />}
          />
        )}
        <div className={clsx(nativeShell ? "mt-0" : "mt-6")}>
          <Heatmap nativeShell={nativeShell} />
        </div>
      </div>
    </PageShell>
  );
}
