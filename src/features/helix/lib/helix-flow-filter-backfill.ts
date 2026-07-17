import type { HelixDteFilter } from "@/features/helix/lib/helix-table-columns";

/** Target visible rows after a restrictive filter — auto-load until met or exhausted. */
export const HELIX_FILTER_BACKFILL_TARGET = 75;

/** Safety cap on consecutive auto-backfill pages per filter session. */
export const HELIX_FILTER_BACKFILL_MAX_PAGES = 15;

type TypeFilter = "ALL" | "CALL" | "PUT";

export type HelixTapeFilterSnapshot = {
  dteFilter: HelixDteFilter;
  typeFilter: TypeFilter;
  whalesOnly: boolean;
  indicesOnly: boolean;
  watchlistOnly: boolean;
  tickerFilter: string;
};

/** Map DTE pill → Postgres max_dte (ET calendar). month+ has no server scope. */
export function dteFilterMaxDte(filter: HelixDteFilter): number | undefined {
  switch (filter) {
    case "0dte":
      return 0;
    case "week":
      return 7;
    default:
      return undefined;
  }
}

/** True when the user narrowed the tape beyond the default "all flows" view. */
export function isRestrictiveTapeFilter(f: HelixTapeFilterSnapshot): boolean {
  if (f.dteFilter !== "all") return true;
  if (f.typeFilter !== "ALL") return true;
  if (f.whalesOnly) return true;
  if (f.indicesOnly) return true;
  if (f.watchlistOnly) return true;
  if (f.tickerFilter.trim().length > 0) return true;
  return false;
}

export function shouldAutoBackfillTape(params: {
  filters: HelixTapeFilterSnapshot;
  filteredCount: number;
  hasMorePages: boolean;
  loading: boolean;
  loadingOlder: boolean;
  replayMode: boolean;
  pagesLoaded: number;
}): boolean {
  if (params.replayMode || params.loading || params.loadingOlder) return false;
  if (!params.hasMorePages) return false;
  if (!isRestrictiveTapeFilter(params.filters)) return false;
  if (params.filteredCount >= HELIX_FILTER_BACKFILL_TARGET) return false;
  if (params.pagesLoaded >= HELIX_FILTER_BACKFILL_MAX_PAGES) return false;
  return true;
}
