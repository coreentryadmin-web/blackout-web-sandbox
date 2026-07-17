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
      contentClassName={clsx(
        "helix-page-content max-w-none",
        nativeShell ? "helix-page-content-native !py-0" : "!py-0 md:!py-1"
      )}
    >
      {!nativeShell && (
        // Slim sticky brand row sits flush under the fixed nav — tide inline so the
        // command bar + tape grid can consume the rest of the viewport.
        <div className="content-rail max-w-none helix-pro-header helix-pro-header--compact">
          <div className="helix-pro-header-brand">
            <ProductMark product="helix" size={28} animated={false} />
            <h1 className="helix-pro-title helix-pro-title--compact">HELIX</h1>
            <span className="sr-only">Institutional flow intelligence</span>
          </div>
          <HelixTideBar className="helix-pro-tide helix-pro-tide--compact" />
        </div>
      )}
      <div
        className={clsx(
          "content-rail max-w-none ios-native-content-rail",
          nativeShell ? "helix-page-inner-native" : "helix-page-inner"
        )}
      >
        {nativeShell && (
          <div className="helix-native-tide">
            <HelixTideBar />
          </div>
        )}
        <FlowAnomalyBanner />
        <FlowFeed />
      </div>
    </PageShell>
  );
}
