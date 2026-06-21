import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { indexStore } from "@/lib/ws/polygon-socket";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = async () => {
        try {
          let snapshot = indexStore; // default: in-memory
          try {
            const redis = await getUwCacheRedis();
            if (redis) {
              const raw = await redis.get("spx:pulse:snapshot");
              if (raw) snapshot = JSON.parse(raw);
            }
          } catch { /* use in-memory fallback */ }

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
          if (interval) clearInterval(interval);
          interval = null;
          controller.close();
        }
      };

      interval = setInterval(() => { void send(); }, 250);
      void send();
    },
    cancel() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
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
