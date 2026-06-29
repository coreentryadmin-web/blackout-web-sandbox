import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { FlowFeed } from "@/components/FlowFeed";
import { FlowAnomalyBanner } from "@/components/FlowAnomalyBanner";
import { HelixTideBar } from "@/components/desk/HelixTideBar";

export const metadata: Metadata = {
  title: "HELIX · BlackOut",
  description: "Whale & dark-pool options flow — real-time institutional tape.",
};

export default async function FlowsPage() {
  await requireTier("premium");

  return (
    <PageShell fullBleed>
      <div className="content-rail">
        <PageHeader
          kicker="Institutional flow"
          title="Helix"
          subtitle="Whale and dark-pool alerts on a single live tape."
          badge={<ProductMark product="helix" size={44} animated={false} />}
        />
        <div className="mt-3">
          <HelixTideBar />
        </div>
      </div>
      <div className="mt-4 max-w-none px-2 md:px-3">
        <FlowAnomalyBanner />
        <FlowFeed />
      </div>
    </PageShell>
  );
}
