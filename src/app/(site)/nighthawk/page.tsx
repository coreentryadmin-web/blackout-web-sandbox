import { requireTier } from "@/lib/auth-access";

import { PageShell, PageHeader, Badge } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";

import { NightHawkFeed } from "@/components/NightHawkFeed";

import { NightHawkRadarBackdrop } from "@/components/nighthawk/NightHawkRadarBackdrop";
import { NightHawkBackdrop } from "@/components/nighthawk/NightHawkBackdrop";

export default async function NightHawkPage() {
  await requireTier("premium");

  return (
    <>
      {/* Cinematic night-vision operator scene — the dominant fixed backdrop. */}
      <NightHawkBackdrop />

      {/* Radar kept as a faint screen-blended recon-HUD over the operator. */}
      <div className="nighthawk-radar-hud" aria-hidden>
        <NightHawkRadarBackdrop />
      </div>

      <div className="nv-scanlines" aria-hidden />

      {/* Radar paints the canvas, so suppress PageShell's own ambient backdrop and
          run full-bleed; the inner column re-creates the full-height desk flex
          context the .nighthawk-layout grid depends on. */}
      <PageShell backdrop={false} fullBleed contentClassName="!py-0" className="!bg-transparent">
        {/* Full-bleed desk column (max-w-none) preserving Night Hawk's edge-to-edge
            layout; the constrained height + flex re-creates the desk context the
            .nighthawk-content-canvas / .nighthawk-layout grid relies on. */}
        <div className="flex min-h-[calc(100svh-var(--nav-offset))] max-w-none flex-col px-2 pb-4 pt-4 md:px-3">
          <PageHeader
            kicker="◆ OVERNIGHT RECON"
            title="NIGHT HAWK"
            subtitle="Tomorrow's playbook · After-hours recon"
            badge={<ProductMark product="nighthawk" size={44} />}
            actions={
              <Badge tone="bear" dot>
                Night Ops
              </Badge>
            }
            className="mb-3 shrink-0"
          />

          <NightHawkFeed />
        </div>
      </PageShell>

      <div className="nighthawk-ops-badge">
        <span className="nighthawk-ops-badge-dot" />
        Night Ops Active
      </div>
    </>
  );
}
