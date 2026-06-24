import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-access";
import { PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { AdminAnalyticsDashboard } from "@/components/admin/AdminAnalyticsDashboard";

export const revalidate = 0;

export default async function AdminPage() {
  await requireAdmin();

  return (
    <div className="admin-page admin-page-canvas">
      <main id="main" className="admin-page-main">
        <PageHeader
          className="mb-6"
          kicker="◆ OPERATIONS"
          title="ADMIN"
          subtitle="Live engine, incidents, API command & desk telemetry — the BlackOut control room."
          badge={<ProductMark product="spx" size={44} />}
        />
        <Suspense fallback={<p className="admin-api-muted p-6">Loading admin…</p>}>
          <AdminAnalyticsDashboard />
        </Suspense>
      </main>
    </div>
  );
}
