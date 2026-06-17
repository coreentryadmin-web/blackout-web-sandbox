"use client";

import { TradingViewWidget } from "@/components/embeds/TradingViewWidget";
import { NightHawkRadar } from "@/components/embeds/NightHawkRadar";

export function NightHawkEmbeds() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
      <NightHawkRadar />
      <TradingViewWidget
        type="hotlists"
        title="Momentum Watchlist"
        height={320}
      />
    </div>
  );
}
