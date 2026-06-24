import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin-access";
import { Nav } from "@/components/Nav";

export default async function CursorApiAnalysisLayout({ children }: { children: ReactNode }) {
  await requireAdmin();

  return (
    <div className="docs-page">
      <Nav />
      <div className="docs-ref-content docs-ref-content-full">{children}</div>
    </div>
  );
}
