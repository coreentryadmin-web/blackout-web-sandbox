import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { GridBoard } from "@/components/grid/GridBoard";

export const metadata: Metadata = {
  title: "BlackOut Grid · BlackOut",
  description: "Market-intelligence command center — news, flow, analyst actions and the pulse on one live board.",
};

/**
 * /grid — BlackOut Grid. Server Component: tier gate + launch gate + metadata; the client GridBoard
 * owns layout/polling/SSE. Gated to `grid` (LAUNCHED_TOOLS=grid to flip live; admins bypass), so
 * non-admins see the ComingSoon padlock until it ships.
 */
export default async function GridPage() {
  await requireTier("premium");
  if (!(await canAccessTool("grid"))) return <ComingSoon toolKey="grid" />;

  return (
    <PageShell fullBleed>
      <div className="px-3 md:px-5">
        <PageHeader
          kicker="◆ MARKET INTELLIGENCE"
          title="BLACKOUT GRID"
          subtitle="The whole tape on one board · News · Flow · Analysts · Pulse"
          badge={<ProductMark product="grid" size={44} />}
        />
        <div className="mt-5">
          <GridBoard />
        </div>
      </div>
    </PageShell>
  );
}
