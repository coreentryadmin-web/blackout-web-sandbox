// NOTE: This broadcaster is currently unused by pulse/stream/route.ts which reads Redis directly. It is retained for future use.
/**
 * Server-side Polygon WebSocket → SSE broadcaster.
 * Maintains ONE WebSocket connection to Polygon indices feed.
 * All connected SSE clients share this single connection.
 * Only runs server-side (imported only from API routes).
 */

type Subscriber = (data: SpxBar) => void

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
  private ws: any = null
  private reconnectTimer: any = null
  private authenticated = false
  private reconnectAttempts = 0
  private readonly MAX_RECONNECT_ATTEMPTS = 10
  private reconnecting = false

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    if (!this.ws && !this.reconnecting) this.connect()
    return () => this.subscribers.delete(fn)
  }

  private connect() {
    this.reconnecting = true
    if (typeof WebSocket === 'undefined') {
      // Node.js — use ws package
      try {
        const WS = require('ws')
        const wsUrl =
          process.env.POLYGON_WS_INDICES ??
          process.env.POLYGON_WS_URL ??
          'wss://socket.polygon.io/indices'
        this.ws = new WS(wsUrl)
        this.setupHandlers()
      } catch {
        console.error('[SpxBroadcaster] ws package not installed — run: npm install ws')
        this.reconnecting = false
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('[SpxBroadcaster] Max reconnect attempts reached')
      this.reconnecting = false
      return
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000)
    const jitter = Math.random() * 1000
    this.reconnectAttempts++
    setTimeout(() => this.connect(), delay + jitter)
  }

  private setupHandlers() {
    const apiKey = process.env.POLYGON_API_KEY ?? ''
    this.ws.on('open', () => {
      this.reconnecting = false
      this.reconnectAttempts = 0
      this.ws.send(JSON.stringify({ action: 'auth', params: apiKey }))
    })
    this.ws.on('message', (raw: Buffer) => {
      try {
        const packets = JSON.parse(raw.toString())
        for (const pkt of Array.isArray(packets) ? packets : [packets]) {
          if (pkt.status === 'auth_success') {
            this.authenticated = true
            this.ws.send(JSON.stringify({ action: 'subscribe', params: 'AM.I:SPX,AM.I:VIX' }))
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
      } catch (e) { console.warn('[SpxBroadcaster] message parse error:', e) }
    })
    this.ws.on('close', () => {
      this.authenticated = false
      this.ws = null
      this.reconnecting = true
      this.scheduleReconnect()
    })
    this.ws.on('error', (err: Error) => {
      console.error('[SpxBroadcaster] WS error:', err.message)
    })
  }

  get subscriberCount() { return this.subscribers.size }
}

// Singleton — shared across all API route invocations in the same Node.js process
export const spxBroadcaster = new SpxBroadcaster()
