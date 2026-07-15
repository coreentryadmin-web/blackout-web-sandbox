import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { getIndexStoreStatus } from "@/lib/ws/polygon-socket";
import { getUwSocketHealth } from "@/lib/ws/uw-socket";
import { getOptionsSocketStatus, inOptionsMarketHours } from "@/lib/ws/options-socket";
import { getStocksSocketStatus } from "@/lib/ws/stocks-socket";
import {
  buildUwClusterHealth,
  evaluatePolygonClusterOk,
  evaluateUwClusterOk,
  readPolygonClusterHealth,
} from "@/lib/ws/socket-cluster-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron-accessible WebSocket health probe — boots lazy sockets and returns live
 * cluster-local status. Used by RTH validation instead of brittle Railway log grep.
 *
 * Multi-replica note: only one task holds each WS leader lock. Followers report
 * CLOSED locally but are healthy when the Redis cluster heartbeat is fresh.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    ok: boolean;
    as_of: string;
    market_hours: boolean;
    websockets: Record<string, unknown>;
    error?: string;
  } | null = null;

  try {
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
    if (luld.luld_enabled) {
      if (!rth) {
        luld_detail = "enabled, off-hours — auth not required";
      } else if (!luld.is_leader) {
        luld_detail = "enabled, follower — cluster leader maintains LULD feed";
      } else if (luld.authenticated && luld.ws_state === "open") {
        luld_detail = `live (${luld.luld_tickers.join(", ")})`;
      } else {
        luld_ok = false;
        luld_detail = `leader but not authenticated (${luld.ws_state})`;
      }
    }

    const polygonLocal = getIndexStoreStatus();
    const uwLocal = getUwSocketHealth();
    const uwCluster = buildUwClusterHealth({
      is_leader: uwLocal.is_leader,
      cluster_last_message_at: uwLocal.cluster_last_message_at,
    });
    const polygonCluster = await readPolygonClusterHealth(polygonLocal.is_leader);
    const uwEval = evaluateUwClusterOk(uwCluster, rth);
    const polygonEval = evaluatePolygonClusterOk(polygonCluster, rth);

    payload = {
      ok: options_ok && luld_ok && uwEval.ok && polygonEval.ok,
      as_of: new Date().toISOString(),
      market_hours: rth,
      websockets: {
        polygon_indices: {
          ...polygonLocal,
          cluster: polygonCluster,
          ok: polygonEval.ok,
          detail: polygonEval.detail,
        },
        unusual_whales: {
          ...uwLocal,
          cluster: uwCluster,
          ok: uwEval.ok,
          detail: uwEval.detail,
        },
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
  } catch (err) {
    console.error("[cron/socket-health]", err instanceof Error ? err.message : err);
    payload = {
      ok: false,
      as_of: new Date().toISOString(),
      market_hours: false,
      websockets: {},
      error: err instanceof Error ? err.message : "socket-health probe failed",
    };
  } finally {
    await logCronRun("socket-health", started, {
      ok: payload?.ok ?? false,
      market_hours: payload?.market_hours ?? false,
      error: payload && "error" in payload ? payload.error : undefined,
    }).catch((err) => {
      console.error("[cron/socket-health] logCronRun failed:", err instanceof Error ? err.message : err);
    });
  }

  if (payload == null) {
    return NextResponse.json({ ok: false, error: "probe failed" }, { status: 500 });
  }

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
