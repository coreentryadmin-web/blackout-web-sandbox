import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { getCurrentSpxCandle } from "@/lib/ws/spx-candle-store";
import { getGexStrikeExpiryLadder } from "@/lib/ws/uw-socket";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import {
  computeGexWalls,
  mapFromStrikeTotalsRecord,
  nextWallScope,
  type GexWalls,
  type WallScopeState,
} from "@/lib/providers/gex-wall-levels";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { sseBackpressureExceeded } from "@/lib/sse-backpressure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same fan-out shape as spx/pulse/stream/route.ts (one shared in-memory read per tick,
// not one per connection) — the candle store read is already O(1), but this keeps the
// pattern consistent and leaves room to add dark-pool/flow to the SAME snapshot later
// without changing the connection-handling shape.
// 1s cadence (not pulse's 250ms): a 1-minute-bar candlestick has nothing meaningful to
// show more often than that.
const TICK_MS = 1_000;

// gex_strike_expiry stores EVERY expiry UW has ever pushed, and for SPX the far-dated
// monthly/quarterly OpEx OI dwarfs the near-term walls — summing it unscoped produces a
// call/put wall that would visibly diverge from the Thermal/Grid GEX panels (same failure
// mode documented in gex-cross-validation.ts). Scope to the near-term expiry set the
// existing GEX heatmap already computes and caches for 15s — refreshing that scope only
// once per cache window (not every 1s tick) costs nothing extra since fetchGexHeatmap is
// itself cache-backed, and the wall LEVELS still recompute from the live WS ladder on
// every tick in between. nextWallScope() (gex-wall-levels.ts) is the pure decision function —
// unit-tested there — because a naive "just overwrite" here silently reverts to unscoped on a
// transient Polygon miss (fetchGexHeatmap resolves to an empty/expiry-less heatmap rather than
// rejecting), which is exactly the divergence bug this scoping exists to prevent.
const WALL_SCOPE_REFRESH_MS = 15_000;
let wallScope: WallScopeState = { expiries: undefined, fetchedAt: 0 };
let wallScopeInFlight: Promise<void> | null = null;

// The UW WS socket (and therefore getGexStrikeExpiryLadder) only ever runs on ONE cluster
// replica — the elected leader; see the leader-election doc block in uw-socket.ts. Every other
// replica gets `null` from getGexStrikeExpiryLadder forever, which without a fallback means most
// production traffic would never see a wall at all. fetchGexHeatmap's own cache-backed
// `gex.strike_totals` is already scoped server-side to the same near-term expiries (see
// GexHeatmap.near_term_expiries' doc) and is available on every replica, so it doubles as the
// fallback ladder for computeGexWalls() when the live WS ladder is unavailable.
let fallbackStrikeTotals: Record<string, number> | null = null;

function refreshWallScope(): void {
  const now = Date.now();
  if (now - wallScope.fetchedAt < WALL_SCOPE_REFRESH_MS || wallScopeInFlight) return;
  wallScopeInFlight = fetchGexHeatmap("SPX")
    .then((hm) => {
      wallScope = nextWallScope(wallScope, Date.now(), hm);
      if (hm?.gex?.strike_totals && Object.keys(hm.gex.strike_totals).length > 0) {
        fallbackStrikeTotals = hm.gex.strike_totals;
      }
    })
    .catch(() => {
      wallScope = nextWallScope(wallScope, Date.now(), null);
    })
    .finally(() => {
      wallScopeInFlight = null;
    });
}

// Computing walls means rebuilding a Map over up to ~2500 ladder cells (ladderFromGexStrikeExpiryCells).
// Each SSE connection runs its own per-second `send()` timer (below), so without this shared
// cache every one of up to MAX_STREAMS concurrent viewers would redo that rebuild every second —
// an O(cells) x O(connections) x O(1/sec) cost instead of the "one shared read per tick" this
// file's connection-handling is supposed to preserve (matches the candle-store read's shape).
// A cache window just under TICK_MS means concurrent connections' independently-phased timers
// mostly land on the same cached value instead of each recomputing.
const WALLS_CACHE_MS = 900;
let cachedWalls: GexWalls | null = null;
let cachedWallsAt = 0;

function getCurrentGexWalls(): GexWalls | null {
  refreshWallScope();
  const now = Date.now();
  if (now - cachedWallsAt < WALLS_CACHE_MS) return cachedWalls;

  const ws = getGexStrikeExpiryLadder("SPX", wallScope.expiries);
  if (ws) {
    cachedWalls = computeGexWalls(ws.ladder);
  } else if (fallbackStrikeTotals) {
    cachedWalls = computeGexWalls(mapFromStrikeTotalsRecord(fallbackStrikeTotals));
  } else {
    cachedWalls = null;
  }
  cachedWallsAt = now;
  return cachedWalls;
}

let activeStreams = 0;
const MAX_STREAMS = Number(process.env.SSE_MAX_STREAMS ?? 2000);

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  if (activeStreams >= MAX_STREAMS) {
    return new NextResponse("Too many active streams — try again shortly", { status: 503 });
  }

  ensureDataSockets();
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let counted = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (counted) activeStreams = Math.max(0, activeStreams - 1);
    if (interval) { clearInterval(interval); interval = null; }
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        if (closed) return;
        if (sseBackpressureExceeded(controller.desiredSize)) {
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
          return;
        }
        try {
          const { current, updatedAt } = getCurrentSpxCandle();
          const walls = getCurrentGexWalls();
          const data = JSON.stringify({ candle: current, walls, t: updatedAt });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
        }
      };

      activeStreams++;
      counted = true;
      req.signal.addEventListener("abort", cleanup);

      interval = setInterval(send, TICK_MS);
      send();

      heartbeatInterval = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);
    },
    cancel() {
      cleanup();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
