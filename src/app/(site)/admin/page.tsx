import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-access";
import { PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { AdminAnalyticsDashboard } from "@/components/admin/AdminAnalyticsDashboard";
import { SignalAnalyticsPanel } from "@/components/spx/SignalAnalyticsPanel";

export const revalidate = 0;

export default async function AdminPage() {
  await requireAdmin();

  return (
    <div className="admin-page admin-page-canvas">
      <main id="main" className="admin-page-main">
        <PageHeader
          className="mb-6"
          kicker="Operations"
          title="Admin"
          subtitle="Engine health, incidents, API telemetry, and desk analytics."
          badge={<ProductMark product="spx" size={44} />}
        />
        <Suspense fallback={<p className="admin-api-muted p-6">Loading admin…</p>}>
          <AdminAnalyticsDashboard />
        </Suspense>

        <div className="mt-10 mb-2 px-1">
          <h2 className="text-xs font-mono text-white/40 uppercase tracking-widest">Signal analytics</h2>
          <p className="text-xs text-white/20 font-mono mt-0.5">Per-signal accuracy vs baseline — which factors have real predictive alpha</p>
        </div>
        <Suspense fallback={<p className="admin-api-muted p-6">Loading signal analytics…</p>}>
          <SignalAnalyticsPanel />
        </Suspense>
      </main>
    </div>
  );
}
