import { NextRequest } from 'next/server'
import { spxBroadcaster } from '@/lib/spx-broadcaster'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/market/live
 * SSE stream of live SPX/VIX 1-minute bars from Polygon WebSocket.
 * 500 users share ONE Polygon WS connection via the spxBroadcaster singleton.
 *
 * Client usage:
 *   const es = new EventSource('/api/market/live')
 *   es.onmessage = (e) => { const bar = JSON.parse(e.data); ... }
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection confirmation
      controller.enqueue(encoder.encode('data: {"connected":true}\n\n'))

      const unsub = spxBroadcaster.subscribe((bar) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(bar)}\n\n`))
        } catch {
          unsub()
        }
      })

      // Cleanup when client disconnects
      req.signal.addEventListener('abort', () => {
        unsub()
        try { controller.close() } catch {}
      })
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
