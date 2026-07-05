import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool, canAccessZeroDteCommand } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { GridPageTabs } from "@/components/zerodte/GridPageTabs";
import { GridTickerProvider } from "@/lib/grid/grid-ticker-context";

export const metadata: Metadata = {
  title: "0DTE Command · BlackOut",
  description:
    "The always-on 0DTE hunter — scans the tape all session for new single-name plays, cross-checks every find against the full evidence stack, and keeps a graded ledger.",
};

/**
 * /grid — 0DTE Command (admin preview tab) + the classic Market Grid tab.
 * Server Component: tier gate + launch gate + metadata; the client tabs own
 * layout/polling. Premium users see 0DTE Command + Market Grid tabs; Largo stays gated.
 *
 * Product rule: this surface finds NEW plays only — it never reprints the SPX
 * engines' plays or Night Hawk's picks. The server-side scanner (grid-warm cron)
 * hunts every ~2 min through RTH whether or not anyone has the page open.
 *
 * The GridTickerProvider still wraps everything so the classic tab's search bar
 * and panels share ticker state exactly as before.
 */
export default async function GridPage() {
  await requireTier("premium");
  if (!(await canAccessTool("grid"))) return <ComingSoon toolKey="grid" />;

  const showZeroDteCommand = await canAccessZeroDteCommand();

  return (
    <PageShell fullBleed>
      <div className="px-2 sm:px-4 xl:px-6">
        <GridTickerProvider>
          <PageHeader
            kicker={showZeroDteCommand ? "Always-on 0DTE hunter" : "Cross-market recon"}
            title={showZeroDteCommand ? "0DTE Command" : "Market Grid"}
            subtitle={
              showZeroDteCommand
                ? "Runs all session finding new 0DTE plays — fresh names only, every find logged and graded."
                : "Unified news, flow, movers, macro, and dealer positioning — one ticker-scoped command surface."
            }
            badge={<ProductMark product="grid" size={44} />}
          />
          <div className="mt-5">
            <GridPageTabs showZeroDteCommand={showZeroDteCommand} />
          </div>
        </GridTickerProvider>
      </div>
    </PageShell>
  );
}
