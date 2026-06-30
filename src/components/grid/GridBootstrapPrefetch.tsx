"use client";

import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { GridBootstrapPayload } from "@/lib/providers/grid";

const BOOTSTRAP_URL = "/api/grid/bootstrap";

/** Maps bootstrap panel keys to the SWR cache keys each panel panel uses (market-wide, no ticker). */
const PANEL_SWR_KEYS: Record<keyof GridBootstrapPayload["panels"], string> = {
  analysts: "/api/grid/analysts",
  darkPool: "/api/grid/dark-pool",
  earnings: "/api/grid/earnings",
  congress: "/api/grid/congress",
  economy: "/api/grid/economy",
  sectors: "/api/grid/sectors",
  movers: "/api/grid/movers",
  catalysts: "/api/grid/catalysts",
};

async function fetchBootstrap(url: string): Promise<GridBootstrapPayload> {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`grid/bootstrap ${res.status}`);
  return res.json() as Promise<GridBootstrapPayload>;
}

/**
 * Fetches all Redis-backed Grid snapshots once, then seeds each panel's SWR cache so
 * the masonry paints on the first frame instead of waiting on 8 staggered HTTP calls.
 */
export function GridBootstrapPrefetch() {
  const { mutate } = useSWRConfig();
  const { data } = useSWR(BOOTSTRAP_URL, fetchBootstrap, {
    revalidateOnFocus: true,
    dedupingInterval: 30_000,
  });

  useEffect(() => {
    if (!data?.panels) return;
    for (const key of Object.keys(PANEL_SWR_KEYS) as (keyof GridBootstrapPayload["panels"])[]) {
      const swrKey = PANEL_SWR_KEYS[key];
      const panel = data.panels[key];
      if (panel) void mutate(swrKey, panel, { revalidate: false });
    }
  }, [data, mutate]);

  return null;
}
