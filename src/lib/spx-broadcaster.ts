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

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    if (!this.ws) this.connect()
    return () => this.subscribers.delete(fn)
  }

  private connect() {
    if (typeof WebSocket === 'undefined') {
      // Node.js — use ws package
      try {
        const WS = require('ws')
        this.ws = new WS('wss://socket.massive.com/indices')
        this.setupHandlers()
      } catch {
        console.error('[SpxBroadcaster] ws package not installed — run: npm install ws')
      }
    }
  }

  private setupHandlers() {
    const apiKey = process.env.POLYGON_API_KEY ?? ''
    this.ws.on('open', () => {
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
      } catch {}
    })
    this.ws.on('close', () => {
      this.authenticated = false
      this.ws = null
      this.reconnectTimer = setTimeout(() => this.connect(), 5000)
    })
    this.ws.on('error', (err: Error) => {
      console.error('[SpxBroadcaster] WS error:', err.message)
    })
  }

  get subscriberCount() { return this.subscribers.size }
}

// Singleton — shared across all API route invocations in the same Node.js process
export const spxBroadcaster = new SpxBroadcaster()
