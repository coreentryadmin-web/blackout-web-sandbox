import { NextRequest } from 'next/server'
import { spxBroadcaster } from '@/lib/spx-broadcaster'
import { authorizeMarketDeskApi } from '@/lib/market-api-auth'
import { sseBackpressureExceeded } from '@/lib/sse-backpressure'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Per-instance connection cap (fd/memory guard). The broadcaster fans out a single Polygon
// WS to all subscribers, so each connection is cheap — this just bounds a runaway fan-out
// (the route previously had NO cap). Override via SSE_MAX_STREAMS.
let activeStreams = 0
const MAX_STREAMS = Number(process.env.SSE_MAX_STREAMS ?? 2000)

/**
 * GET /api/market/live
 * SSE stream of live SPX/VIX 1-minute bars from the Polygon WebSocket.
 * All viewers share ONE Polygon WS via the spxBroadcaster singleton (fan-out).
 *
 * Client usage:
 *   const es = new EventSource('/api/market/live')
 *   es.onmessage = (e) => { const bar = JSON.parse(e.data); ... }
 */
export async function GET(req: NextRequest) {
  // Premium SPX/VIX stream — gate per connection (same data as /api/market/indices).
  const auth = await authorizeMarketDeskApi(req)
  if (auth instanceof Response) return auth

  if (activeStreams >= MAX_STREAMS) {
    return new Response('Too many active streams — try again shortly', { status: 503 })
  }

  const encoder = new TextEncoder()
  let closed = false
  let counted = false
  let unsub: (() => void) | null = null

  // Idempotent teardown: decrements the count exactly once and drops the broadcaster
  // subscription. Reachable from start()'s abort handler / failed enqueue and from cancel().
  const cleanup = () => {
    if (closed) return
    closed = true
    if (counted) activeStreams = Math.max(0, activeStreams - 1)
    if (unsub) unsub()
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"connected":true}\n\n'))
      activeStreams++
      counted = true

      unsub = spxBroadcaster.subscribe((bar) => {
        if (closed) return
        // Backpressure: drop a slow client instead of buffering its controller queue unbounded
        // (mirrors flows/stream). Healthy clients keep desiredSize >= 0 so this never trips.
        if (sseBackpressureExceeded(controller.desiredSize)) {
          cleanup()
          try { controller.close() } catch { /* already closed */ }
          return
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(bar)}\n\n`))
        } catch {
          cleanup()
          try { controller.close() } catch { /* already closed */ }
        }
      })

      req.signal.addEventListener('abort', () => {
        cleanup()
        try { controller.close() } catch { /* already closed */ }
      })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
