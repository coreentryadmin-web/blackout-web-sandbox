import { requireTier } from "@/lib/auth-access";
import { PageShell, PageHeader, Badge } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { FlowFeed } from "@/components/FlowFeed";
import { DnaHelixBackgroundLazy as DnaHelixBackground } from "@/components/DnaHelixBackgroundLazy";

export default async function FlowsPage() {
  await requireTier("premium");

  return (
    <>
      {/* Animated DNA helix wallpaper — fixed behind all content (HELIX canvas) */}
      <DnaHelixBackground />

      {/* DnaHelix paints the canvas, so suppress PageShell's own ambient backdrop. */}
      <PageShell backdrop={false} fullBleed>
        <div className="content-rail">
          <PageHeader
            kicker="◆ INSTITUTIONAL FLOW"
            title="HELIX"
            subtitle="Whale & dark pool alerts · Real-time tape"
            badge={<ProductMark product="helix" size={44} />}
            actions={
              <Badge tone="neutral" dot>
                Live
              </Badge>
            }
          />
        </div>
        <div className="mt-6 max-w-none px-2 md:px-3">
          <FlowFeed />
        </div>
      </PageShell>
    </>
  );
}
