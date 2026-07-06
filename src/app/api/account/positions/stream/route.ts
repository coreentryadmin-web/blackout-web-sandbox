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
import { sseBackpressureExceeded } from "@/lib/sse-backpressure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUSH_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

// Per-instance connection cap (fd/memory guard) — task #170 audit gap: of the codebase's 4 SSE
// routes, this was the only one with NEITHER this cap NOR the backpressure check below. A single
// valid premium session (real user, trial account, or a leaked session cookie) could open an
// unbounded number of connections here — each spawns its own timer loop pushing enriched
// positions every ~3s forever — and simply never read the response body, growing every
// un-drained connection's internal queue without limit: a slow-loris/fan-out DoS against a
// single replica's memory/fd budget using nothing but one valid session. 500 matches the other
// user-facing (non-admin) SSE route (flows/stream); admin's telemetry stream uses a lower 100
// since admins are few. Override via POSITIONS_SSE_MAX_STREAMS.
let activeStreams = 0;
const MAX_STREAMS = Number(process.env.POSITIONS_SSE_MAX_STREAMS ?? 500);

export async function GET(req: Request) {
  const gate = await requireTierApi("premium");
  if (gate instanceof Response) return gate;
  const { userId } = gate;

  // Launch gate — locked to non-admins until this tool ships.
  const locked = await requireToolApi("nighthawk");
  if (locked) return locked;

  if (activeStreams >= MAX_STREAMS) {
    return new Response("Too many active streams — try again shortly", { status: 503 });
  }

  // Boot the shared data sockets (idempotent). Required for live WS option marks.
  ensureDataSockets();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let pushTimer: ReturnType<typeof setTimeout> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let closed = false;
      let counted = false;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (counted) activeStreams = Math.max(0, activeStreams - 1);
        if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      };

      const send = (chunk: string) => {
        if (closed) return;
        // Backpressure: a slow/non-reading client lets the controller's internal queue grow
        // (desiredSize goes increasingly negative). Drop the lagging client rather than let
        // this per-connection loop buffer unbounded — healthy clients keep desiredSize >= 0,
        // so this never trips for them (mirrors flows/stream, spx/pulse/stream, admin/apis/stream).
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

      activeStreams++;
      counted = true;

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
