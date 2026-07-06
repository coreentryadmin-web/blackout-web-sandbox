"use client";

import { clsx } from "clsx";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { NightHawkFeed } from "@/components/NightHawkFeed";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

/** /nighthawk page frame — segment-first on native shell. */
export function NighthawkPageShell() {
  const nativeShell = useIosNativeShell();

  return (
    <PageShell
      fullBleed
      contentClassName={clsx(nativeShell ? "nighthawk-page-content-native !py-0" : "!py-0")}
      className={clsx(
        "ios-native-page ios-native-page-nighthawk",
        nativeShell && "nighthawk-page-shell-native"
      )}
    >
      <div
        className={clsx(
          "nighthawk-page-root flex max-w-none flex-col",
          nativeShell
            ? "nighthawk-page-inner-native min-h-[calc(100dvh-var(--ios-header-offset)-var(--ios-tab-offset))]"
            : "min-h-[calc(100svh-var(--nav-offset)-var(--ios-tab-offset,0px))] px-2 pb-4 pt-4 md:px-3"
        )}
      >
        {!nativeShell && (
          <PageHeader
            kicker="Overnight playbook"
            title="Night Hawk"
            subtitle="Tomorrow's ranked setups — published after the close, ready before the open."
            badge={<ProductMark product="nighthawk" size={44} animated={false} />}
            className="mb-3 shrink-0 [&_p]:text-sky-300"
          />
        )}
        <NightHawkFeed />
      </div>
    </PageShell>
  );
}
