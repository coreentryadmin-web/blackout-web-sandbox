import { subscribeApiTelemetry, getApiTelemetrySnapshot } from "@/lib/api-telemetry";
import { requireAdminApi } from "@/lib/admin-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const snap = getApiTelemetrySnapshot(15 * 60_000);
      send({
        type: "snapshot",
        active_retries: snap.active_retries,
        recent_errors: snap.recent_errors.slice(0, 20),
        totals: snap.totals,
      });

      unsubscribe = subscribeApiTelemetry((event) => {
        send({ type: "event", event });
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
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
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
