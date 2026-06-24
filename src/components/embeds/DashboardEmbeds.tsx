"use client";

import { TradingViewWidget } from "@/components/embeds/TradingViewWidget";
import { LiveMarketPulse } from "@/components/embeds/LiveMarketPulse";
import { DashboardTrackRecordEmbed } from "@/components/embeds/DashboardTrackRecordEmbed";

export function DashboardEmbeds() {
  return (
    <div className="space-y-5 mb-8">
      <TradingViewWidget type="ticker-tape" title="Market Tape" height={52} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <TradingViewWidget
            type="advanced-chart"
            symbol="CBOE:SPX"
            title="SPX Live Chart"
            height={500}
          />
        </div>
        <LiveMarketPulse />
      </div>
      <TradingViewWidget
        type="market-overview"
        title="Index & Mag 7 Recon"
        height={340}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-5">
        <DashboardTrackRecordEmbed className="xl:col-span-1" />
      </div>
    </div>
  );
}
