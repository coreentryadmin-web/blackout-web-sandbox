import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { getIndexStoreStatus } from "@/lib/ws/polygon-socket";
import { getUwSocketHealth } from "@/lib/ws/uw-socket";
import { getOptionsSocketStatus, inOptionsMarketHours } from "@/lib/ws/options-socket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron-accessible WebSocket health probe — boots lazy sockets and returns live
 * cluster-local status. Used by RTH validation instead of brittle Railway log grep.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  ensureDataSockets();

  const options = getOptionsSocketStatus();
  const authenticatedShards = options.shards.filter((s) => s.authenticated).length;
  const authFailedShards = options.shards.filter((s) => s.auth_failed).length;
  const rth = inOptionsMarketHours();

  let options_ok = true;
  let options_detail = "disabled — REST snapshot fallback";

  if (options.enabled) {
    if (!rth) {
      options_detail = "enabled, off-hours — auth not required";
    } else if (options.total_contracts === 0) {
      options_detail = "enabled, no held contracts — auth not required";
    } else if (authenticatedShards > 0) {
      options_detail = `authenticated (${authenticatedShards} shard(s), ${options.total_contracts} contracts)`;
    } else if (authFailedShards > 0) {
      options_ok = false;
      options_detail = `auth failed on ${authFailedShards} shard(s) — check POLYGON_API_KEY / options WS entitlement`;
    } else {
      options_ok = false;
      options_detail = "enabled with held contracts but no authenticated shard yet";
    }
  }

  return NextResponse.json(
    {
      ok: options_ok,
      as_of: new Date().toISOString(),
      market_hours: rth,
      websockets: {
        polygon_indices: getIndexStoreStatus(),
        unusual_whales: getUwSocketHealth(),
        options: {
          ...options,
          authenticated_shards: authenticatedShards,
          auth_failed_shards: authFailedShards,
          ok: options_ok,
          detail: options_detail,
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
