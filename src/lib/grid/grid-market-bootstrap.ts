import "server-only";

import { dbConfigured, fetchRecentFlows } from "@/lib/db";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { deskPayloadToSpxState, emptySpxState, type SpxState } from "@/lib/spx-desk-state";

export type GridBootstrapMarket = {
  pulse: SpxState;
  gexSpx: Record<string, unknown> | { available: false };
  flows: { flows: Record<string, unknown>[]; count: number };
};

/** Pulse + GEX + whale flow seed for Grid market-route panels (single server pass). */
export async function readGridBootstrapMarket(): Promise<GridBootstrapMarket> {
  const [deskResult, gexResult, flowsResult] = await Promise.allSettled([
    loadMergedSpxDesk().then(({ merged }) => deskPayloadToSpxState(merged)),
    getGexPositioning("SPX").then((pos) =>
      pos ? ({ available: true, ...pos } as Record<string, unknown>) : ({ available: false } as const),
    ),
    dbConfigured()
      ? fetchRecentFlows({
          limit: 60,
          min_premium: 1_000_000,
          since_hours: 48,
          order: "recent",
        }).then((rows) => ({ flows: rows as Record<string, unknown>[], count: rows.length }))
      : Promise.resolve({ flows: [], count: 0 }),
  ]);

  return {
    pulse: deskResult.status === "fulfilled" ? deskResult.value : emptySpxState(),
    gexSpx: gexResult.status === "fulfilled" ? gexResult.value : { available: false },
    flows: flowsResult.status === "fulfilled" ? flowsResult.value : { flows: [], count: 0 },
  };
}
