import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { LargoTerminal } from "@/components/desk/LargoTerminal";
import { TradingViewWidget } from "@/components/embeds/TradingViewWidget";

export default async function TerminalPage() {
  await requireTier("premium");

  return (
    <div className="page-shell relative overflow-hidden flex flex-col min-h-screen">
      <Nav />
      <PlatformShell
        variant="largo"
        title="AI Terminal"
        subtitle="Largo — Desk-grade market intelligence"
        deskMode
      >
        <div className="flex flex-col xl:flex-row gap-5 xl:items-stretch">
          <div className="xl:flex-[7] min-w-0">
            <LargoTerminal />
          </div>
          <div
            className="hidden xl:block w-px self-stretch shrink-0"
            style={{
              background: "linear-gradient(to bottom, transparent, rgba(191,95,255,0.3), transparent)",
            }}
            aria-hidden
          />
          <div className="xl:flex-[5] min-w-0 space-y-4">
            <div className="largo-widget-panel">
              <div className="largo-widget-label">SPY Context</div>
              <TradingViewWidget type="advanced-chart" symbol="AMEX:SPY" title="SPY Context" height={360} />
            </div>
            <div className="largo-widget-panel">
              <div className="largo-widget-label">Tape</div>
              <TradingViewWidget type="ticker-tape" title="Tape" height={48} />
            </div>
          </div>
        </div>
      </PlatformShell>
    </div>
  );
}
