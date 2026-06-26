"use client";

import { GridCard } from "./GridCard";
import { BenzingaNewsRail } from "@/components/desk/BenzingaNewsRail";

/**
 * Panel 2 — Unified News Feed. REUSES the multi-channel Benzinga news rail (BenzingaNewsRail →
 * fetchMarketNews → /api/market/news, server-cached). This is where the news scroll belongs — on
 * the Grid, not bolted onto the per-tool desks. The rail self-scrolls and self-badges live state.
 */
export function GridNewsPanel() {
  return (
    <GridCard title="Unified News" kicker="NEWS" accent="sky" live span={2}>
      <div className="grid-news-mount">
        <BenzingaNewsRail />
      </div>
    </GridCard>
  );
}
