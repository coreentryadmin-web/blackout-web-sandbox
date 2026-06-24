import { requireTier } from "@/lib/auth-access";
import { PageShell, PageHeader, Badge } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { Heatmap } from "@/components/Heatmap";

export default async function HeatmapPage() {
  await requireTier("premium");

  return (
    <>
      <PageShell fullBleed>
        <div className="px-4 md:px-6">
          <PageHeader
            kicker="◆ DEALER POSITIONING"
            title="HEATMAPS"
            subtitle="Dealer gamma & vanna exposure · GEX walls, flip & flow"
            badge={<ProductMark product="heatmap" size={44} />}
            actions={
              <Badge tone="accent" dot>
                GEX · VEX
              </Badge>
            }
          />
          <div className="mt-6">
            <Heatmap />
          </div>
        </div>
      </PageShell>
    </>
  );
}
