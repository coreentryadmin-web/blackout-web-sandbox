import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { Heatmap } from "@/components/Heatmap";

export default async function HeatmapPage() {
  await requireTier("premium");
  if (!(await canAccessTool("heatmap"))) return <ComingSoon toolKey="heatmap" />;

  return (
    <>
      <PageShell fullBleed>
        <div className="px-4 md:px-6">
          {/* The "GEX · VEX" actions badge was removed — the lens toggles
              (GEX/VEX/DEX/CHARM) now live on the desk's compact control row and
              carry that label, so the header badge was pure duplication. The
              subtitle is trimmed for the same reason: the desk states the
              dealer-gamma/vanna read in-panel. */}
          <PageHeader
            kicker="◆ DEALER POSITIONING"
            title="HEATMAPS"
            subtitle="Dealer gamma & vanna exposure"
            badge={<ProductMark product="heatmap" size={44} />}
          />
          <div className="mt-6">
            <Heatmap />
          </div>
        </div>
      </PageShell>
    </>
  );
}
