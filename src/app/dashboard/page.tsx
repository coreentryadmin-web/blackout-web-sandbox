import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PageBanner } from "@/components/PageBanner";
import { SpxDashboard } from "@/components/SpxDashboard";
import { IMAGES } from "@/lib/images";

export const revalidate = 0;

export default async function DashboardPage() {
  await requireTier("premium");

  return (
    <div className="page-shell">
      <Nav />
      <main className="page-main">
        <PageBanner
          src={IMAGES.spxSniper}
          alt="SPX Sniper Bot — Precision. Patience. Profit."
        />
        <div className="page-header">
          <h1 className="page-title">SPX DASHBOARD</h1>
          <span className="badge-live">
            <span className="badge-live-dot" />
            Live
          </span>
        </div>
        <SpxDashboard />
      </main>
    </div>
  );
}
