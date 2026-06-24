import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin-access";
import { Nav } from "@/components/Nav";
import { UwDocsNav } from "@/components/docs/UwDocsNav";

export default async function UnusualWhalesDocsLayout({ children }: { children: ReactNode }) {
  await requireAdmin();

  return (
    <div className="docs-page">
      <Nav />
      <div className="docs-ref-layout">
        <aside className="docs-ref-sidebar docs-ref-sidebar-wide">
          <UwDocsNav />
        </aside>
        <div className="docs-ref-content">{children}</div>
      </div>
    </div>
  );
}
