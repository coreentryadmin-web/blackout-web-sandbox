import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { LargoTerminal } from "@/components/desk/LargoTerminal";
import { PageHeader, Badge } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";

export default async function TerminalPage() {
  await requireTier("premium");

  // NOTE: /terminal is a full-viewport chat layout (height:100dvh, internal
  // scroll). We deliberately keep the `largo-page-shell`/`largo-page-main` flex
  // frame rather than wrapping in <PageShell> — PageShell paints a scrolling
  // content-rail, which would break the terminal's pinned full-height + internal
  // scroll design. The header chrome is re-skinned onto the design-system
  // primitives below.
  return (
    <div className="largo-page-shell">
      <Nav />
      <main id="main" className="largo-page-main">
        <PageHeader
          className="largo-page-header"
          kicker="AI DESK ANALYST"
          title={
            <span className="flex items-center gap-3">
              <ProductMark product="largo" size={36} />
              LARGO
            </span>
          }
          subtitle={
            <>
              Live desk intel ·{" "}
              <span className="text-cyan-300">your AI desk officer</span>
            </>
          }
          badge={
            <Badge tone="accent" dot>
              AI Online
            </Badge>
          }
        />
        <LargoTerminal fullPage />
      </main>
      <div className="platform-ambient platform-ambient-largo" aria-hidden />
      <div className="platform-dot-grid" aria-hidden />
    </div>
  );
}
