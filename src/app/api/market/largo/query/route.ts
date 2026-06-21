import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { largoConfigured, runLargoQuery, runLargoQueryStream, isSseClientDisconnect, SseClientDisconnected } from "@/lib/largo-terminal";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";

// ---------------------------------------------------------------------------
// Largo concurrency gate — max 2 simultaneous queries per user, Redis-backed.
// Fails open (acquired = true) when Redis is unavailable so queries still work.
// ---------------------------------------------------------------------------

type GateRedis = {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(key: string, value: string | number): Promise<"OK">;
} | null;

const MAX_LARGO_CONCURRENT = 2;
const LARGO_TTL_S = 180; // 3 min — auto-expire stuck counters

async function acquireLargoSlot(userId: string): Promise<{ acquired: boolean; redis: GateRedis }> {
  // getUwCacheRedis returns a minimal RedisClient type; cast to GateRedis so we
  // can call incr/decr/expire which ioredis supports at runtime.
  const redis = (await getUwCacheRedis()) as GateRedis;
  if (!redis) return { acquired: true, redis: null }; // fail-open: no Redis → no gate

  const key = `largo:active:${userId}`;
  try {
    const count = await redis.incr(key);
    await redis.expire(key, LARGO_TTL_S);
    if (count > MAX_LARGO_CONCURRENT) {
      await redis.decr(key);
      return { acquired: false, redis };
    }
    return { acquired: true, redis };
  } catch {
    // Redis error → fail-open so queries are never blocked by infra issues
    return { acquired: true, redis: null };
  }
}

async function releaseLargoSlot(userId: string, redis: GateRedis): Promise<void> {
  if (!redis) return;
  const key = `largo:active:${userId}`;
  try {
    const val = await redis.decr(key);
    if (val < 0) await redis.set(key, 0); // clamp to 0 if it goes negative
  } catch {
    /* non-fatal — TTL will clean up the key within LARGO_TTL_S seconds */
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function wantsStream(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get("stream") === "1") return true;
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/event-stream");
}

export async function POST(req: NextRequest) {
  const authResult = await requireTierApi("premium");
  if (authResult instanceof Response) return authResult;

  if (!largoConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured on server" },
      { status: 503 }
    );
  }

  let body: { question?: string; session_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = String(body.question ?? "").trim();
  const sessionId = String(body.session_id ?? "").trim();

  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  if (question.length > 4000) {
    return NextResponse.json({ error: "question too long" }, { status: 400 });
  }

  const resolvedSessionId = sessionId || `web-${authResult.userId}-${Date.now()}`;

  // Concurrency gate — max MAX_LARGO_CONCURRENT simultaneous queries per user.
  const userId = authResult.userId;
  const slot = await acquireLargoSlot(userId);
  if (!slot.acquired) {
    return NextResponse.json(
      { error: "Too many active Largo sessions. Please wait for a previous query to complete." },
      { status: 429 }
    );
  }

  if (wantsStream(req)) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const markClosed = () => {
          closed = true;
        };
        req.signal.addEventListener("abort", markClosed, { once: true });

        const send = (payload: unknown): boolean => {
          if (closed || req.signal.aborted) {
            closed = true;
            return false;
          }
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            return true;
          } catch (err) {
            closed = true;
            if (!isSseClientDisconnect(err)) {
              console.warn("[market/largo/query stream] enqueue failed:", err);
            }
            return false;
          }
        };

        try {
          await runLargoQueryStream(question, resolvedSessionId, userId, (event) => {
            if (!send(event)) {
              closed = true;
              throw new SseClientDisconnected();
            }
          });
        } catch (error) {
          if (isSseClientDisconnect(error)) return;
          console.error("[market/largo/query stream]", error);
          send({ type: "error", message: error instanceof Error ? error.message : "Largo query failed" });
        } finally {
          closed = true;
          // Release the concurrency slot before closing the stream controller.
          await releaseLargoSlot(userId, slot.redis);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Connection: "keep-alive",
        Pragma: "no-cache",
      },
    });
  }

  try {
    const result = await runLargoQuery(question, resolvedSessionId, userId);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/largo/query]", error);
    const message = error instanceof Error ? error.message : "Largo query failed";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    // Release the concurrency slot whether the non-streaming query succeeded or failed.
    await releaseLargoSlot(userId, slot.redis);
  }
}
