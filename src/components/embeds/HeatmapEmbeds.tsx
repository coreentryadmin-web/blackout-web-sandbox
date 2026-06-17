"use client";

import { TradingViewWidget } from "@/components/embeds/TradingViewWidget";

export function HeatmapEmbeds() {
  return (
    <div className="space-y-5 mb-8">
      <TradingViewWidget
        type="stock-heatmap"
        title="S&P 500 Thermal Map"
        height={520}
      />
      <TradingViewWidget
        type="market-overview"
        title="Sector Rotation Monitor"
        height={360}
      />
    </div>
  );
}
