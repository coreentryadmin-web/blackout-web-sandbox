import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { SpxDashboard } from "@/components/SpxDashboard";
import { IMAGES } from "@/lib/images";

export const revalidate = 0;

export default async function DashboardPage() {
  await requireTier("premium");

  return (
    <div className="page-shell relative overflow-hidden">
      <Nav />
      <PlatformShell
        variant="dashboard"
        title="SPX Dashboard"
        subtitle="GEX · VWAP · Regime · Dealer positioning"
        imageSrc={IMAGES.spxSniper}
        imageAlt="SPX Sniper Bot — Precision. Patience. Profit."
      >
        <SpxDashboard />
      </PlatformShell>
    </div>
  );
}
