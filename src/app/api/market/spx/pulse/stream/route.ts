import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { indexStore } from "@/lib/ws/polygon-socket";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap concurrent SSE connections per instance. Each connection holds one 250ms
// timer that issues a Redis GET, so an unbounded fan-out hammers Redis and the
// container fd limit. 500 per instance is safe; scale horizontally for more.
// Override via SSE_MAX_STREAMS env var. Mirrors flows/stream/route.ts.
let activeStreams = 0;
const MAX_STREAMS = Number(process.env.SSE_MAX_STREAMS ?? 500);

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
  // Idempotent teardown: prevents enqueue-after-close, clears both timers, and
  // decrements the connection count exactly once. Mirrors admin/apis/stream.
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
      const send = async () => {
        if (closed) return;
        try {
          let snapshot = indexStore; // default: in-memory
          try {
            const redis = await getUwCacheRedis();
            if (redis) {
              const raw = await redis.get("spx:pulse:snapshot");
              if (raw) snapshot = JSON.parse(raw);
            }
          } catch { /* use in-memory fallback */ }

          if (closed) return;
          const data = JSON.stringify({
            spx: snapshot["I:SPX"],
            vix: snapshot["I:VIX"],
            vix9d: snapshot["I:VIX9D"],
            vix3m: snapshot["I:VIX3M"],
            tick: snapshot["I:TICK"],
            trin: snapshot["I:TRIN"],
            add: snapshot["I:ADD"],
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
      req.signal.addEventListener("abort", cleanup);

      interval = setInterval(() => { void send(); }, 250);
      void send();

      // Periodic SSE comment heartbeat — keeps the connection alive through
      // proxies and load balancers that have idle-timeout defaults (Railway,
      // nginx, etc.). Fires every 15 seconds regardless of data activity.
      heartbeatInterval = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          // pulse-heartbeat-swallow fix: a failed heartbeat enqueue means the
          // client is gone — tear down instead of silently leaking the timers.
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
