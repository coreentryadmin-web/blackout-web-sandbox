import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { requireAnyToolApi } from "@/lib/tool-access-server";
import { subscribeMatrixDeltas } from "@/lib/gex-matrix-broadcast";
import type { GexMatrix } from "@/lib/gex-matrix-delta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/market/gex-matrix-deltas?ticker=SPY
 *
 * Server-Sent Events (SSE) endpoint for real-time GEX matrix delta updates.
 *
 * Flow:
 * 1. Client connects and receives an initial full snapshot of the current heatmap
 * 2. Client keeps connection open to receive strike-level deltas as they broadcast
 * 3. Each delta includes only changed strikes (changes ≥ $100 notional threshold)
 * 4. Client merges deltas into local matrix for perceived real-time updates
 *
 * Connection management:
 * - Subscribers auto-remove after 30 min TTL (SUBSCRIBER_TTL_MS in broadcast module)
 * - Dead connections (write errors) are automatically removed from subscribers
 * - Server maintains up to MAX_SUBSCRIBERS (10000) to prevent memory leak
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  // Launch gate — same as /api/market/gex-heatmap
  const locked = await requireAnyToolApi(["spx", "heatmap"]);
  if (locked) return locked;

  const ticker = (req.nextUrl.searchParams.get("ticker") || "SPY").toUpperCase();

  // Validate ticker
  if (!/^[A-Z0-9.\-]{1,8}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  try {
    // Fetch the current heatmap snapshot to send as initial data
    const snapshot = await fetchGexHeatmap(ticker);
    if (!snapshot) {
      return NextResponse.json(
        { error: "Matrix not available for ticker", underlying: ticker },
        { status: 400 }
      );
    }

    // Create an SSE response stream
    const encoder = new TextEncoder();
    let isClosed = false;

    const stream = new ReadableStream({
      start(controller) {
        // Send initial snapshot
        const snapshotEvent = `data: ${JSON.stringify({
          type: "snapshot",
          ticker,
          data: snapshot,
        })}\n\n`;
        controller.enqueue(encoder.encode(snapshotEvent));

        // Subscribe to delta broadcasts
        // The unsubscribe function is returned and called on stream close
        const unsubscribe = subscribeMatrixDeltas({
          write: async (payload: string) => {
            if (isClosed) throw new Error("Stream closed");
            try {
              controller.enqueue(encoder.encode(payload));
            } catch (err) {
              isClosed = true;
              controller.close();
              throw err;
            }
          },
        });

        // Track when stream closes so we can unsubscribe
        const originalClose = controller.close.bind(controller);
        controller.close = () => {
          isClosed = true;
          unsubscribe();
          return originalClose();
        };
      },
      cancel() {
        isClosed = true;
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[market/gex-matrix-deltas] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
