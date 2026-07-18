import { NextRequest } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { initFlowEventBridge, subscribeFlowEvents } from "@/lib/flow-events";
import { enrichFlowWithGex, getGexLevelsForTicker } from "@/lib/flow-gex-enrichment";
import { sseBackpressureExceeded } from "@/lib/sse-backpressure";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cap concurrent SSE connections per instance. Each connection is cheap (one timer + one callback)
// but ECS containers have fd limits. 500 per instance is safe; scale horizontally for more.
// Override via SSE_MAX_STREAMS env var.
let activeStreams = 0;
const MAX_STREAMS = Number(process.env.SSE_MAX_STREAMS ?? 500);

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const tickerFilter = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim() || undefined;

  // Boot the UW WebSocket (idempotent) so a replica serving ONLY /flows traffic still
  // initializes uwSocket — without this the live tape's SSE bridge never receives WS
  // frames and silently goes empty unless the REST cron happens to run here (audit
  // gap #4). nodejs runtime is declared above, so this is edge-safe.
  ensureDataSockets();

  if (activeStreams >= MAX_STREAMS) {
    return new Response("Too many active streams — try again shortly", { status: 503 });
  }

  await initFlowEventBridge();

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  // Bug 2: closed flag prevents enqueue after error + ensures cleanup runs once
  let closed = false;
  let counted = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (counted) activeStreams = Math.max(0, activeStreams - 1);
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        // Backpressure: a slow client lets the controller's internal queue grow
        // (desiredSize goes increasingly negative). Drop the lagging client rather
        // than buffer unbounded. Healthy clients keep desiredSize >= 0, so this never trips for them.
        if (sseBackpressureExceeded(controller.desiredSize)) {
          try {
            controller.close();
          } catch {
            // already closed/errored
          }
          cleanup();
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          cleanup();
        }
      };

      activeStreams++;
      counted = true;
      send({ type: "connected", ts: Date.now() });

      unsubscribe = subscribeFlowEvents((flow) => {
        if (tickerFilter && flow.ticker?.toUpperCase() !== tickerFilter) return;
        void (async () => {
          const gex = await getGexLevelsForTicker(flow.ticker);
          const enriched = gex ? enrichFlowWithGex(flow, gex) : flow;
          send({ type: "flow", ...enriched });
        })();
      });

      heartbeat = setInterval(() => {
        send({ type: "heartbeat", ts: Date.now() });
      }, 25_000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
