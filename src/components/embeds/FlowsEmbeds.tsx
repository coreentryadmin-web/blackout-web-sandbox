"use client";

import { TradingViewWidget } from "@/components/embeds/TradingViewWidget";
import { LiveFlowTape } from "@/components/embeds/LiveFlowTape";
import { FlowVolumeChart } from "@/components/embeds/FlowVolumeChart";
import type { FlowAlert } from "@/lib/api";

type FlowsEmbedsProps = {
  alerts: FlowAlert[];
};

export function FlowsEmbeds({ alerts }: FlowsEmbedsProps) {
  return (
    <div className="space-y-5 mb-6">
      <TradingViewWidget type="ticker-tape" title="Cross-Asset Tape" height={52} />
      <LiveFlowTape alerts={alerts} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <FlowVolumeChart alerts={alerts} />
        <TradingViewWidget
          type="symbol-overview"
          symbol="AMEX:SPY"
          title="SPY Flow Context"
          height={280}
        />
      </div>
      <TradingViewWidget type="hotlists" title="US Hot Lists" height={420} />
    </div>
  );
}
