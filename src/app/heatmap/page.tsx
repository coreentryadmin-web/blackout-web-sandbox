import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { Heatmap } from "@/components/Heatmap";

export default async function HeatmapPage() {
  await requireTier("premium");

  return (
    <div className="page-shell">
      <Nav />
      <main className="page-main">
        <div className="page-header">
          <h1 className="page-title">HEATMAPS</h1>
          <span className="page-subtitle">Sector & Stock Performance</span>
        </div>
        <Heatmap />
      </main>
    </div>
  );
}
