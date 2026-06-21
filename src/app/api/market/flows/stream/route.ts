import { NextRequest } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { initFlowEventBridge, subscribeFlowEvents } from "@/lib/flow-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Bug 16: cap concurrent SSE connections to prevent resource exhaustion
let activeStreams = 0;
const MAX_STREAMS = 50;

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

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
        send({ type: "flow", ...flow });
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
