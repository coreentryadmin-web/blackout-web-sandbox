import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { GridBoard } from "@/components/grid/GridBoard";
import { GridSearchBar } from "@/components/grid/GridSearchBar";
import { GridLiveBackground } from "@/components/grid/GridLiveBackground";
import { GridTickerProvider } from "@/lib/grid/grid-ticker-context";

export const metadata: Metadata = {
  title: "BlackOut Grid · BlackOut",
  description: "Cross-market intelligence — news, flow, analyst actions, and market pulse on one board.",
};

/**
 * /grid — BlackOut Grid. Server Component: tier gate + launch gate + metadata; the client GridBoard
 * owns layout/polling/SSE. Gated to `grid` (LAUNCHED_TOOLS=grid to flip live; admins bypass), so
 * non-admins see the ComingSoon padlock until it ships.
 *
 * The GridTickerProvider wraps both the search bar (in PageHeader) and GridBoard so they share state.
 * GridSearchBar mounts in the page header right of the title; the "/" key focuses it.
 */
export default async function GridPage() {
  await requireTier("premium");
  if (!(await canAccessTool("grid"))) return <ComingSoon toolKey="grid" />;

  return (
    <PageShell fullBleed backdropSlot={<GridLiveBackground />}>
      <div className="px-2 sm:px-4 xl:px-6">
        <GridTickerProvider>
          <PageHeader
            kicker="Market intelligence"
            title="BlackOut Grid"
            subtitle="News, flow, analyst actions, and market pulse on one board."
            badge={<ProductMark product="grid" size={44} />}
            actions={<GridSearchBar />}
          />
          <div className="mt-5">
            <GridBoard />
          </div>
        </GridTickerProvider>
      </div>
    </PageShell>
  );
}
