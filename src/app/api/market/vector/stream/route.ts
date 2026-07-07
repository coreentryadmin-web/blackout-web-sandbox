import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { getCurrentSpxCandle } from "@/lib/ws/spx-candle-store";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { sseBackpressureExceeded } from "@/lib/sse-backpressure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same fan-out shape as spx/pulse/stream/route.ts (one shared in-memory read per tick,
// not one per connection) — the candle store read is already O(1), but this keeps the
// pattern consistent and leaves room for Phase C to add dark-pool/flow/GEX fields to the
// SAME snapshot without changing the connection-handling shape.
// 1s cadence (not pulse's 250ms): a 1-minute-bar candlestick has nothing meaningful to
// show more often than that.
const TICK_MS = 1_000;

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
          const data = JSON.stringify({ candle: current, t: updatedAt });
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
