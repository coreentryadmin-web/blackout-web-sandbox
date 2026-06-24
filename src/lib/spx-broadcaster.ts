// Used by /api/market/live (SSE): ONE Polygon indices WS shared by all SSE subscribers
// (fan-out). The pulse stream uses a separate in-memory/Redis path; this serves the AM 1-min
// SPX/VIX bar feed.
/**
 * Server-side Polygon WebSocket → SSE broadcaster.
 * Maintains ONE WebSocket connection to the Polygon indices feed.
 * All connected SSE clients share this single connection.
 * Only runs server-side (imported only from API routes).
 */

type Subscriber = (data: SpxBar) => void

// Node's undici WebSocket does NOT expose `ErrorEvent` as a runtime global, so
// `event instanceof ErrorEvent` throws ReferenceError on the WS error path. Extract
// the message portably, mirroring polygonErrorMessage() in ws/polygon-socket.ts.
function polygonErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  const evt = err as { message?: string; error?: unknown; type?: string }
  if (typeof evt?.message === 'string') return evt.message
  if (evt?.error instanceof Error) return evt.error.message
  if (typeof evt?.type === 'string') return evt.type
  return String(err)
}

export interface SpxBar {
  sym: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  ts: number
  vwap?: number
}

class SpxBroadcaster {
  private subscribers = new Set<Subscriber>()
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private authenticated = false
  private reconnectAttempts = 0
  private reconnecting = false

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    if (!this.ws && !this.reconnecting) this.connect()
    return () => {
      this.subscribers.delete(fn)
      // Last listener gone — drop any pending reconnect and tear down the upstream WS so we don't
      // hold a Polygon connection (or reconnect-loop) with nobody listening. teardownSocket()
      // nulls this.ws SYNCHRONOUSLY (close() fires 'close' async) so a resubscribe in the close
      // window re-connects via the !this.ws guard above instead of attaching to a doomed socket.
      if (this.subscribers.size === 0) {
        this.clearReconnect()
        this.reconnecting = false
        this.teardownSocket()
      }
    }
  }

  /** Synchronously detach + null the socket so a resubscribe in the async-close window re-connects
   *  cleanly, and the stale 'close' handler can't fire against (or schedule a reconnect over) a new
   *  connection. */
  private teardownSocket() {
    const sock = this.ws
    this.ws = null
    if (sock) {
      try {
        sock.onopen = null
        sock.onmessage = null
        sock.onclose = null
        sock.onerror = null
        sock.close()
      } catch {
        /* already closed */
      }
    }
  }

  private connect() {
    this.reconnecting = true
    const wsUrl =
      process.env.POLYGON_WS_INDICES ??
      process.env.POLYGON_WS_URL ??
      'wss://socket.polygon.io/indices'
    try {
      // Node >=20.9 (our runtime is v24) and browsers ship a GLOBAL WebSocket — use it directly,
      // matching the sibling socket modules (polygon-socket / uw-socket / options-socket). The
      // prior `typeof WebSocket === 'undefined'` guard INVERTED this: on every supported runtime
      // the global exists, so connect()'s body was skipped entirely and the feed never connected
      // (reconnecting stuck true, never re-armed). That's the dead-feed fix.
      this.ws = new WebSocket(wsUrl)
      this.setupHandlers(this.ws)
    } catch (e) {
      console.error('[SpxBroadcaster] failed to open WS:', e)
      this.reconnecting = false
    }
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private scheduleReconnect() {
    // No listeners → don't maintain a reconnect loop. A new subscriber re-establishes it.
    if (this.subscribers.size === 0) {
      this.reconnecting = false
      return
    }
    // Cancel any pending reconnect so overlapping 'close' events cannot stack
    // multiple concurrent connect() attempts (single-timer pattern, see uw-socket.ts).
    this.clearReconnect()
    // Exponential backoff CAPPED at 60s, retried INDEFINITELY while subscribers exist. The old
    // hard give-up (MAX_RECONNECT_ATTEMPTS=10) left the live feed permanently dead after a short
    // outage with no recovery until a process restart — but the network/Polygon feed do come
    // back. reconnectAttempts resets to 0 on a successful open, so backoff restarts after recovery.
    const delay = Math.min(1000 * Math.pow(2, Math.min(this.reconnectAttempts, 6)), 60000)
    const jitter = Math.random() * 1000
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay + jitter)
  }

  private setupHandlers(ws: WebSocket) {
    const apiKey = process.env.POLYGON_API_KEY ?? ''
    ws.onopen = () => {
      if (this.ws !== ws) return // stale socket
      this.reconnecting = false
      this.reconnectAttempts = 0
      ws.send(JSON.stringify({ action: 'auth', params: apiKey }))
    }
    ws.onmessage = (event) => {
      if (this.ws !== ws) return // stale socket — ignore late frames
      try {
        const packets = JSON.parse(String(event.data))
        for (const pkt of Array.isArray(packets) ? packets : [packets]) {
          if (pkt.status === 'auth_success') {
            this.authenticated = true
            ws.send(JSON.stringify({ action: 'subscribe', params: 'AM.I:SPX,AM.I:VIX' }))
          }
          if (pkt.ev === 'AM' && this.authenticated) {
            const bar: SpxBar = {
              sym: pkt.sym,
              open: pkt.o,
              high: pkt.h,
              low: pkt.l,
              close: pkt.c,
              volume: pkt.v,
              ts: pkt.s ?? pkt.e,
              vwap: pkt.vw,
            }
            this.subscribers.forEach((fn) => fn(bar))
          }
        }
      } catch (e) {
        console.warn('[SpxBroadcaster] message parse error:', e)
      }
    }
    ws.onclose = () => {
      // Identity guard: only the CURRENT socket's close should reset state + reconnect. A stale
      // socket's late close (after teardown/replacement) must not null the live ws or schedule
      // a reconnect over it.
      if (this.ws !== ws) return
      this.authenticated = false
      this.ws = null
      this.reconnecting = true
      this.scheduleReconnect()
    }
    ws.onerror = (event) => {
      console.error('[SpxBroadcaster] WS error:', polygonErrorMessage(event))
    }
  }

  get subscriberCount() {
    return this.subscribers.size
  }
}

// Singleton — shared across all API route invocations in the same Node.js process
export const spxBroadcaster = new SpxBroadcaster()
