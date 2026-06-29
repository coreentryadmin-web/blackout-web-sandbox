import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { LargoTerminal } from "@/components/desk/LargoTerminal";
import { PageHeader, Badge } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";

export const metadata: Metadata = {
  title: "Largo · BlackOut",
  description: "Your AI desk officer — live desk intel grounded in BlackOut's tools.",
};

export default async function TerminalPage() {
  await requireTier("premium");
  if (!(await canAccessTool("largo"))) return <ComingSoon toolKey="largo" />;

  // NOTE: /terminal is a full-viewport chat layout (height:100dvh, internal
  // scroll). We deliberately keep the `largo-page-shell`/`largo-page-main` flex
  // frame rather than wrapping in <PageShell> — PageShell paints a scrolling
  // content-rail, which would break the terminal's pinned full-height + internal
  // scroll design. The header chrome is re-skinned onto the design-system
  // primitives below.
  return (
    <div className="largo-page-shell">
      <main id="main" className="largo-page-main">
        <PageHeader
          className="largo-page-header"
          kicker="AI desk analyst"
          title={
            <span className="flex items-center gap-3">
              <ProductMark product="largo" size={36} />
              Largo
            </span>
          }
          subtitle="Live desk intel · grounded in platform data"
          badge={
            <Badge tone="accent" dot>
              AI Online
            </Badge>
          }
        />
        <LargoTerminal fullPage />
        <p className="font-mono text-[10px] text-sky-300/60 text-center pt-1">
          Educational. Not advice. You decide.
        </p>
      </main>
    </div>
  );
}
