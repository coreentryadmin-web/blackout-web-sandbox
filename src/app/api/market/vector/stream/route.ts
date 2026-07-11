import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker } from "@/features/vector";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import {
  attachVectorStreamSubscriber,
  detachVectorStreamSubscriber,
  getVectorStreamDeltaFrame,
  getVectorStreamFullFrame,
  releaseVectorStreamConnection,
  tryAcquireVectorStreamConnection,
} from "@/features/vector/lib/vector-stream-hub";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { sseBackpressureExceeded } from "@/lib/sse-backpressure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICK_MS = 1_000;
const MAX_STREAMS = Number(process.env.SSE_MAX_STREAMS ?? 2000);

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const ticker = normalizeVectorTicker(req.nextUrl.searchParams.get("ticker"));
  // Universe-gate the symbol: any 8-char string used to spin a dedicated 1 Hz
  // poller whose payload build fetched a full day of Polygon minute bars every
  // second — one member with invented tickers could drive ~N provider calls/s
  // and grow per-ticker server state without bound. The page only offers
  // universe tickers, so anything else is a hand-crafted request.
  if (!vectorUniverseTickers().includes(ticker)) {
    return NextResponse.json({ error: `Unknown Vector ticker: ${ticker}` }, { status: 400 });
  }

  // Claim the slot atomically — the old read-then-increment spanned the stream
  // construction and let concurrent connects overshoot the cap.
  if (!tryAcquireVectorStreamConnection(MAX_STREAMS)) {
    return new NextResponse("Too many active streams — try again shortly", { status: 503 });
  }

  ensureDataSockets();
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let sentFull = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    releaseVectorStreamConnection();
    detachVectorStreamSubscriber(ticker);
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      let lastSentFrame: string | null = null;
      const send = () => {
        if (closed) return;
        if (sseBackpressureExceeded(controller.desiredSize)) {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        // First frame carries the FULL wall history (client seeds/merges once);
        // steady-state frames carry only the latest sample — shipping the whole
        // history (~1MB by late session) per connection per second was the
        // dominant egress cost and killed slow clients via backpressure exactly
        // when frames were biggest.
        const frame = sentFull
          ? getVectorStreamDeltaFrame(ticker)
          : getVectorStreamFullFrame(ticker);
        if (!frame) return;
        // Hub reuses the same string until its 1s refresh — identity compare
        // skips re-sending an unchanged frame (common off-hours).
        if (frame === lastSentFrame) return;
        try {
          controller.enqueue(encoder.encode(frame));
          lastSentFrame = frame;
          sentFull = true;
        } catch {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };

      attachVectorStreamSubscriber(ticker);
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
