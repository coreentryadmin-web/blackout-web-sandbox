"use client";

import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { AtlasChart, type AtlasBar } from "@/components/atlas/AtlasChart";

type Props = {
  initialBars: AtlasBar[];
};

/** /atlas page frame — mirrors GridPageShell's PageShell/PageHeader/ProductMark structure. */
export function AtlasPageShell({ initialBars }: Props) {
  return (
    <PageShell fullBleed className="atlas-page-shell">
      <div className="px-2 sm:px-4 xl:px-6">
        <PageHeader
          kicker="Live SPX chart"
          title="Atlas"
          subtitle="SPX price action with real-time dark-pool, flow, and GEX level overlays."
          badge={<ProductMark product="atlas" size={44} animated={false} />}
        />
        <div className="mt-5">
          <AtlasChart initialBars={initialBars} />
        </div>
      </div>
    </PageShell>
  );
}
