import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { FlowFeed } from "@/components/FlowFeed";
import { FlowAnomalyBanner } from "@/components/FlowAnomalyBanner";
import { DnaHelixBackgroundLazy as DnaHelixBackground } from "@/components/DnaHelixBackgroundLazy";
import { HelixTideBar } from "@/components/desk/HelixTideBar";

export const metadata: Metadata = {
  title: "HELIX · BlackOut",
  description: "Whale & dark-pool options flow — real-time institutional tape.",
};

export default async function FlowsPage() {
  await requireTier("premium");

  return (
    <>
      {/* Animated DNA helix wallpaper — fixed behind all content (HELIX canvas) */}
      <DnaHelixBackground />

      {/* DnaHelix paints the canvas, so suppress PageShell's own ambient backdrop. */}
      <PageShell backdrop={false} fullBleed>
        <div className="content-rail">
          {/* No static "Live" badge here — it was always green regardless of
              feed state and contradicted the freshness-aware toolbar tri-state.
              FlowFeed's toolbar (live/Stale/Offline) is the single source. */}
          <PageHeader
            kicker="◆ INSTITUTIONAL FLOW"
            title="HELIX"
            subtitle="Whale & dark pool alerts · Real-time tape"
            badge={<ProductMark product="helix" size={44} />}
          />
          {/* Market tide — call/put premium balance + directional bias from UW pulse. */}
          <div className="mt-3">
            <HelixTideBar />
          </div>
        </div>
        <div className="mt-4 max-w-none px-2 md:px-3">
          <FlowAnomalyBanner />
          <FlowFeed />
        </div>
      </PageShell>
    </>
  );
}
