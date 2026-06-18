import type { ReactNode } from "react";
import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PolygonDocsNav } from "@/components/docs/PolygonDocsNav";

export default async function PolygonDocsLayout({ children }: { children: ReactNode }) {
  await requireTier("premium");

  return (
    <div className="docs-page">
      <Nav />
      <div className="docs-ref-layout">
        <aside className="docs-ref-sidebar">
          <PolygonDocsNav />
        </aside>
        <div className="docs-ref-content">{children}</div>
      </div>
    </div>
  );
}
