import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { largoConfigured, runLargoQuery, runLargoQueryStream } from "@/lib/largo-terminal";

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

  if (wantsStream(req)) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        try {
          await runLargoQueryStream(question, resolvedSessionId, authResult.userId, send);
        } catch (error) {
          console.error("[market/largo/query stream]", error);
          const message = error instanceof Error ? error.message : "Largo query failed";
          send({ type: "error", message });
        } finally {
          controller.close();
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
    const result = await runLargoQuery(question, resolvedSessionId, authResult.userId);
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
  }
}
