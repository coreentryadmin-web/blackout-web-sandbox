"use client";

import { clsx } from "clsx";
import { PageShell, PageHeader } from "@/components/ui";
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
        "ios-native-page ios-native-page-helix helix-page-shell",
        nativeShell && "helix-page-shell-native"
      )}
      contentClassName={clsx(nativeShell ? "helix-page-content-native !py-0" : undefined)}
    >
      {!nativeShell && (
        <div className="content-rail">
          <PageHeader
            kicker="Institutional flow"
            title="HELIX"
            subtitle="Whale and dark-pool alerts on a single live tape."
            badge={<ProductMark product="helix" size={44} animated={false} />}
          />
          <div className="mt-3">
            <HelixTideBar />
          </div>
        </div>
      )}
      <div
        className={clsx(
          "content-rail max-w-none ios-native-content-rail",
          nativeShell ? "helix-page-inner-native" : "mt-4"
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
