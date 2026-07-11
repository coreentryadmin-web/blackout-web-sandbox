import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector";
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

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  // Any optionable symbol is allowed on demand (Vector is a search-any-stock
  // desk, not a fixed universe) — but only WELL-FORMED symbols: a junk/oversized
  // string is refused before it can spin a poller. The two amplification vectors
  // the old universe gate guarded are now bounded directly: concurrent pollers by
  // tryAcquireVectorStreamConnection's cap, and per-ticker server state by the
  // LRU eviction in vector-snapshot's state() map.
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: `Invalid ticker` }, { status: 400 });
  }
  const ticker = normalizeVectorTicker(rawTicker);

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
