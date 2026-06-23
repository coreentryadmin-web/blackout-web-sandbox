import { NextRequest, NextResponse } from "next/server";
import {
  getApiTelemetrySnapshot,
  getEventsSinceSeq,
  subscribeApiTelemetry,
} from "@/lib/api-telemetry";
import { requireAdminApi } from "@/lib/admin-access";
import { sseBackpressureExceeded } from "@/lib/sse-backpressure";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const lastEventId = req.headers.get("last-event-id");
  const sinceSeqParam = req.nextUrl.searchParams.get("since_seq");
  const sinceSeq = lastEventId
    ? Number.parseInt(lastEventId, 10)
    : sinceSeqParam
      ? Number.parseInt(sinceSeqParam, 10)
      : 0;

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown, id?: number) => {
        if (closed) return;
        // Backpressure: drop a slow client whose un-drained queue has grown past the
        // threshold instead of buffering unbounded. Healthy clients keep desiredSize >= 0.
        if (sseBackpressureExceeded(controller.desiredSize)) {
          try {
            controller.close();
          } catch {
            // already closed/errored
          }
          cleanup();
          return;
        }
        const idLine = id != null ? `id: ${id}\n` : "";
        try {
          controller.enqueue(encoder.encode(`${idLine}data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Client disconnected; enqueue after close throws. Tear down resources.
          cleanup();
        }
      };

      req.signal.addEventListener("abort", cleanup);

      if (sinceSeq > 0) {
        for (const event of getEventsSinceSeq(sinceSeq)) {
          send({ type: "event", event }, event.seq_id);
        }
      } else {
        const snap = getApiTelemetrySnapshot(15 * 60_000);
        send({
          type: "snapshot",
          active_retries: snap.active_retries,
          recent_errors: snap.recent_errors.slice(0, 20),
          totals: snap.totals,
        });
      }

      unsubscribe = subscribeApiTelemetry((event) => {
        send({ type: "event", event }, event.seq_id);
      });

      heartbeat = setInterval(() => {
        send({
          type: "heartbeat",
          active_retries: getApiTelemetrySnapshot(60_000).active_retries,
          ts: Date.now(),
        });
      }, 8000);
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
