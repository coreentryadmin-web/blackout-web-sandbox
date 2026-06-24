"use client";

import { TradingViewWidget } from "@/components/embeds/TradingViewWidget";
import { LiveMarketPulse } from "@/components/embeds/LiveMarketPulse";
import { LargoTerminal } from "@/components/desk/LargoTerminal";

export function LargoWorkspace() {
  return (
    <div className="space-y-5">
      <TradingViewWidget type="ticker-tape" title="Desk Tape" height={52} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-5 items-start">
        <div className="xl:col-span-2 min-h-[600px] flex flex-col">
          <LargoTerminal />
        </div>
        <div className="space-y-5">
          <LiveMarketPulse compact />
          <TradingViewWidget
            type="symbol-overview"
            symbol="CBOE:SPX"
            title="SPX Context"
            height={300}
          />
          <TradingViewWidget
            type="symbol-overview"
            symbol="NASDAQ:NVDA"
            title="NVDA Context"
            height={300}
          />
        </div>
      </div>
    </div>
  );
}
