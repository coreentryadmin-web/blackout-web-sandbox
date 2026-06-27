// Night's Watch — per-user option-mark SSE stream for real-time P&L updates.
// Pushes enriched positions every 3 seconds so the panel gets live marks without polling.
//
// Each connection runs its OWN loop (no fan-out — this is per-user data, keyed by userId,
// so there is nothing shareable across connections). The enrichment helper already applies
// a 3s single-flight cache per userId, so N concurrent tabs from the same user collapse to
// ONE upstream call anyway — connections are cheap.

import { requireToolApi } from "@/lib/tool-access-server";
import { requireTierApi } from "@/lib/market-api-auth";
import { getEnrichedOpenAndRecentClosedForUser } from "@/lib/nights-watch/enrichment";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUSH_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

export async function GET(req: Request) {
  const gate = await requireTierApi("premium");
  if (gate instanceof Response) return gate;
  const { userId } = gate;

  // Launch gate — locked to non-admins until this tool ships.
  const locked = await requireToolApi("nighthawk");
  if (locked) return locked;

  // Boot the shared data sockets (idempotent). Required for live WS option marks.
  ensureDataSockets();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let pushTimer: ReturnType<typeof setTimeout> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let closed = false;

      const cleanup = () => {
        closed = true;
        if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      };

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const push = async () => {
        if (closed) return;
        try {
          const positions = await getEnrichedOpenAndRecentClosedForUser(userId);
          send(`data: ${JSON.stringify({ positions })}\n\n`);
        } catch {
          // Transient enrichment failure — skip this tick, next tick will retry.
        }
        if (!closed) {
          pushTimer = setTimeout(() => { void push(); }, PUSH_INTERVAL_MS);
        }
      };

      // Abort on client disconnect.
      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });

      // Start heartbeat (keeps connection alive through proxies).
      heartbeatTimer = setInterval(() => {
        send(`data: ${JSON.stringify({ heartbeat: true })}\n\n`);
      }, HEARTBEAT_INTERVAL_MS);

      // Initial push immediately, then every PUSH_INTERVAL_MS.
      await push();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
