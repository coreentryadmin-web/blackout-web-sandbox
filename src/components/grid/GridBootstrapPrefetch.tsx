"use client";

import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { FlowAlert } from "@/lib/api";
import { setGridFlowSeed } from "@/lib/grid/grid-flow-seed";
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
 * Fetches all Grid snapshots once, then seeds each panel's SWR cache (Redis panels + Pulse/GEX/flow)
 * so the masonry paints on the first frame instead of waiting on staggered HTTP calls.
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

  useEffect(() => {
    const market = data?.market;
    if (!market) return;
    if (market.pulse) void mutate("grid-pulse", market.pulse, { revalidate: false });
    const gex = market.gexSpx;
    if (gex && !("available" in gex && gex.available === false)) {
      void mutate("grid-pulse-gex-SPX", gex, { revalidate: false });
    }
    if (market.flows?.flows?.length) {
      setGridFlowSeed({
        flows: market.flows.flows as unknown as FlowAlert[],
        count: market.flows.count,
      });
    }
  }, [data, mutate]);

  return null;
}
