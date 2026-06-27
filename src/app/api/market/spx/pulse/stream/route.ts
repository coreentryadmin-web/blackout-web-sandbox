import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { indexStore } from "@/lib/ws/polygon-socket";
import { tideStore, darkPoolStore } from "@/lib/ws/uw-socket";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { sseBackpressureExceeded } from "@/lib/sse-backpressure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// FAN-OUT (audit Risk #5 fix). The pulse snapshot is IDENTICAL for every viewer,
// so ONE shared module-level poller refreshes it per tick and every SSE connection
// reads that shared copy — instead of each connection issuing its OWN Redis GET
// every 250ms. The old design was O(connections): ~2,000 GETs/sec at the 500 cap,
// on the same Redis the rate-limiters need, for data already in process memory.
// Redis load is now O(1) regardless of how many viewers are connected.
// ---------------------------------------------------------------------------
type PulseSnapshot = Record<string, unknown>;
let latestSnapshot: PulseSnapshot = indexStore;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function localFreshAt(): number | null {
  const spx = indexStore["I:SPX"] as { updatedAt?: number } | undefined;
  return spx && typeof spx.updatedAt === "number" && spx.updatedAt > 0 ? spx.updatedAt : null;
}

async function refreshSnapshot(): Promise<void> {
  try {
    // Prefer THIS replica's local in-memory indexStore — it's the freshest source
    // (updated tick-by-tick by the indices WS, incl. the V channel). Fall back to the
    // cross-replica Redis snapshot only when local hasn't been populated recently (e.g.
    // a replica whose indices socket isn't connected yet).
    const fresh = localFreshAt();
    if (fresh != null && Date.now() - fresh < 10_000) {
      latestSnapshot = indexStore;
      return;
    }
    const redis = await getUwCacheRedis();
    if (redis) {
      const raw = await redis.get("spx:pulse:snapshot");
      if (raw) {
        latestSnapshot = JSON.parse(raw) as PulseSnapshot;
        return;
      }
    }
    latestSnapshot = indexStore; // last resort — stale-but-present beats nothing
  } catch {
    /* keep the previous snapshot on a transient error */
  }
}

function startRefresher(): void {
  if (refreshTimer) return;
  void refreshSnapshot();
  refreshTimer = setInterval(() => { void refreshSnapshot(); }, 250);
  // Don't keep the process alive solely for this timer.
  (refreshTimer as unknown as { unref?: () => void }).unref?.();
}

function stopRefresherIfIdle(): void {
  if (activeStreams <= 0 && refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// Per-instance connection cap. With the fan-out above, Redis load no longer scales
// with connection count, so this now only guards container fd/memory — raised from
// 500 to 2000. Override via SSE_MAX_STREAMS.
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
  // Idempotent teardown: prevents enqueue-after-close, clears both timers, decrements
  // the connection count exactly once, and stops the shared refresher when idle.
  let closed = false;
  let counted = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (counted) {
      activeStreams = Math.max(0, activeStreams - 1);
      stopRefresherIfIdle();
    }
    if (interval) { clearInterval(interval); interval = null; }
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  };

  const stream = new ReadableStream({
    start(controller) {
      // Reads the SHARED snapshot (refreshed once per tick by the module-level poller) —
      // no per-connection Redis GET. The per-connection timer only does an in-memory enqueue.
      const send = () => {
        if (closed) return;
        // Backpressure: a slow client lets the controller's internal queue grow (desiredSize goes
        // increasingly negative). Drop the lagging client rather than buffer unbounded — healthy
        // clients keep desiredSize >= 0 so this never trips for them (mirrors flows/stream).
        if (sseBackpressureExceeded(controller.desiredSize)) {
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
          return;
        }
        try {
          const snapshot = latestSnapshot;
          const tideFresh = tideStore.updatedAt > 0;
          const darkPoolFresh = darkPoolStore.updatedAt > 0 && darkPoolStore.data != null;
          const data = JSON.stringify({
            spx: snapshot["I:SPX"],
            vix: snapshot["I:VIX"],
            vix9d: snapshot["I:VIX9D"],
            vix3m: snapshot["I:VIX3M"],
            tick: snapshot["I:TICK"],
            trin: snapshot["I:TRIN"],
            add: snapshot["I:ADD"],
            tide: tideFresh
              ? {
                  call_premium: tideStore.call_premium,
                  put_premium: tideStore.put_premium,
                  net: tideStore.net,
                  bias: tideStore.bias,
                }
              : undefined,
            darkPool: darkPoolFresh ? darkPoolStore.data : undefined,
            t: Date.now(),
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
        }
      };

      activeStreams++;
      counted = true;
      startRefresher();
      req.signal.addEventListener("abort", cleanup);

      interval = setInterval(send, 250);
      send();

      // Periodic SSE comment heartbeat — keeps the connection alive through proxies and
      // load balancers with idle-timeout defaults (Railway, nginx, etc.). Every 15s.
      heartbeatInterval = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          // A failed heartbeat enqueue means the client is gone — tear down instead of
          // silently leaking the timers.
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
