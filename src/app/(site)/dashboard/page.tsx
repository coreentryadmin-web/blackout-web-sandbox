import Image from "next/image";
import { requireTier } from "@/lib/auth-access";
import { SpxDashboard } from "@/components/SpxDashboard";
import { IMAGES } from "@/lib/images";

export const revalidate = 0;

export default async function DashboardPage() {
  await requireTier("premium");

  return (
    <div className="spx-sniper-page">
      {/* Full-bleed ambient background routed through next/image (fill, cover).
          The .spx-sniper-bg wrapper carries opacity/filter/scale; priority since
          it's above the fold. */}
      <div className="spx-sniper-bg" aria-hidden>
        <Image
          src={IMAGES.dashboardBg}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      </div>
      <div className="spx-sniper-overlay" aria-hidden />
      <main id="main" className="relative z-10 w-full max-w-none px-2 sm:px-3 lg:px-4 xl:px-5 pt-20 pb-8">
        <SpxDashboard />
      </main>
    </div>
  );
}
