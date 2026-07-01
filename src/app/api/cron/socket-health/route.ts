import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { getIndexStoreStatus } from "@/lib/ws/polygon-socket";
import { getUwSocketHealth } from "@/lib/ws/uw-socket";
import { getOptionsSocketStatus, inOptionsMarketHours } from "@/lib/ws/options-socket";
import { getStocksSocketStatus } from "@/lib/ws/stocks-socket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron-accessible WebSocket health probe — boots lazy sockets and returns live
 * cluster-local status. Used by RTH validation instead of brittle Railway log grep.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  ensureDataSockets();

  const options = getOptionsSocketStatus();
  const luld = getStocksSocketStatus();
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

  let luld_ok = true;
  let luld_detail = "disabled — UW trading_halts only";
  if (luld.enabled) {
    if (!rth) {
      luld_detail = "enabled, off-hours — auth not required";
    } else if (luld.authenticated && luld.ws_state === "open") {
      luld_detail = `live (${luld.tickers.join(", ")})`;
    } else {
      luld_ok = false;
      luld_detail = `enabled but not authenticated (${luld.ws_state})`;
    }
  }

  const payload = {
    ok: options_ok && luld_ok,
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
      stocks_luld: {
        ...luld,
        ok: luld_ok,
        detail: luld_detail,
      },
    },
  };

  await logCronRun("socket-health", started, {
    ok: payload.ok,
    market_hours: rth,
    options_ok,
    luld_ok,
  });

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
