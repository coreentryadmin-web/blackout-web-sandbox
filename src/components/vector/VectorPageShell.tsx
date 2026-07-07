"use client";

import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { VectorChart, type VectorBar } from "@/components/vector/VectorChart";

type Props = {
  initialBars: VectorBar[];
};

/** /vector page frame — mirrors GridPageShell's PageShell/PageHeader/ProductMark structure. */
export function VectorPageShell({ initialBars }: Props) {
  return (
    <PageShell fullBleed className="vector-page-shell">
      <div className="px-2 sm:px-4 xl:px-6">
        <PageHeader
          kicker="Live SPX chart"
          title="Vector"
          subtitle="SPX price action with real-time dark-pool, flow, and GEX level overlays."
          badge={<ProductMark product="vector" size={44} animated={false} />}
        />
        <div className="mt-5">
          <VectorChart initialBars={initialBars} />
        </div>
      </div>
    </PageShell>
  );
}
