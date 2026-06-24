import { requireTier } from "@/lib/auth-access";
import { PageShell, PageHeader, Badge } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { Heatmap } from "@/components/Heatmap";

export default async function HeatmapPage() {
  await requireTier("premium");

  return (
    <>
      <PageShell>
        <PageHeader
          kicker="◆ SECTOR ROTATION"
          title="HEATMAPS"
          subtitle="Sector rotation · Institutional movers"
          badge={<ProductMark product="heatmap" size={44} />}
          actions={
            <Badge tone="accent" dot>
              Thermal Scan
            </Badge>
          }
        />
        <div className="mt-6">
          <Heatmap />
        </div>
      </PageShell>
    </>
  );
}
