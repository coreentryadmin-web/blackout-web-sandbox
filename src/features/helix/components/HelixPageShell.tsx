"use client";

import { clsx } from "clsx";
import { PageShell } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { FlowFeed } from "@/features/helix/components/FlowFeed";
import { FlowAnomalyBanner } from "@/components/FlowAnomalyBanner";
import { HelixTideBar } from "@/features/helix/components/HelixTideBar";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

/** /flows page frame — tide + tape on native; full header on web. */
export function HelixPageShell() {
  const nativeShell = useIosNativeShell();

  return (
    <PageShell
      fullBleed
      className={clsx(
        "ios-native-page ios-native-page-helix helix-page-shell helix-pro-shell",
        nativeShell && "helix-page-shell-native"
      )}
      contentClassName={clsx(nativeShell ? "helix-page-content-native !py-0" : undefined)}
    >
      {!nativeShell && (
        <div className="content-rail helix-pro-header">
          <div className="helix-pro-header-copy">
            <p className="helix-pro-kicker">Institutional flow intelligence</p>
            <div className="helix-pro-title-row">
              <ProductMark product="helix" size={36} animated={false} />
              <h1 className="helix-pro-title">HELIX</h1>
            </div>
            <p className="helix-pro-subtitle">
              Live options tape, contract drilldown, and flow analytics on one desk.
            </p>
          </div>
          <HelixTideBar className="helix-pro-tide lg:mb-1" />
        </div>
      )}
      <div
        className={clsx(
          "content-rail max-w-none ios-native-content-rail",
          nativeShell ? "helix-page-inner-native" : "mt-4 helix-page-inner"
        )}
      >
        {nativeShell && (
          <div className="helix-native-tide mb-2">
            <HelixTideBar />
          </div>
        )}
        <FlowAnomalyBanner />
        <FlowFeed />
      </div>
    </PageShell>
  );
}
