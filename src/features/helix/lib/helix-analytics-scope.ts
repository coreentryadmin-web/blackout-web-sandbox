import type { HelixDteFilter } from "@/features/helix/lib/helix-table-columns";
import {
  isRestrictiveTapeFilter,
  type HelixTapeFilterSnapshot,
} from "@/features/helix/lib/helix-flow-filter-backfill";

const DTE_LABELS: Record<HelixDteFilter, string | null> = {
  all: null,
  "0dte": "0DTE",
  week: "≤7d",
  "month+": ">7d",
};

/** True when the desk is scoped to one underlying (hides market-wide discovery panels). */
export function isSingleTickerScope(tickerFilter: string): boolean {
  return tickerFilter.trim().length > 0;
}

/** Panels that only make sense across many names — hide when a single ticker is selected. */
export function showMarketWideAnalyticsPanels(tickerFilter: string): boolean {
  return !isSingleTickerScope(tickerFilter);
}

/** Human-readable active filter chips for the analytics rail header. */
export function formatHelixAnalyticsScopeLabel(filters: HelixTapeFilterSnapshot): string {
  const parts: string[] = [];
  const ticker = filters.tickerFilter.trim().toUpperCase();
  if (ticker) parts.push(ticker);
  const dte = DTE_LABELS[filters.dteFilter];
  if (dte) parts.push(dte);
  if (filters.typeFilter !== "ALL") parts.push(filters.typeFilter);
  if (filters.whalesOnly) parts.push("Whales");
  if (filters.indicesOnly) parts.push("Indices");
  if (filters.watchlistOnly) parts.push("Watchlist");
  return parts.length > 0 ? parts.join(" · ") : "All flow";
}

export { isRestrictiveTapeFilter };
