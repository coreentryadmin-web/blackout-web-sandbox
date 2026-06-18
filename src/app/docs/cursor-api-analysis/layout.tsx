import type { ReactNode } from "react";
import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";

export default async function CursorApiAnalysisLayout({ children }: { children: ReactNode }) {
  await requireTier("premium");

  return (
    <div className="docs-page">
      <Nav />
      <div className="docs-ref-content docs-ref-content-full">{children}</div>
    </div>
  );
}
