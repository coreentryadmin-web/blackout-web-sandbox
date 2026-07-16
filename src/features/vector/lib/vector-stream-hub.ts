/**
 * Per-ticker Vector SSE fan-out — one payload build per second per ticker, shared by
 * all connections watching that symbol. Mirrors spx/pulse/stream shared refresher pattern.
 */
import { buildVectorStreamPayload, type VectorStreamPayload } from "./vector-snapshot";
import { normalizeVectorTicker } from "./vector-ticker";

const TICK_MS = 1_000;

type TickerHub = {
  subscribers: number;
  /** Complete payload incl. full wallHistory — sent once per connection on attach. */
  latestFullFrame: string | null;
  /**
   * Same payload with wallHistory trimmed to the latest sample — the steady-state
   * frame. Shipping the FULL history (up to 5760 samples at 5s cadence by late session)
   * to every connection every second was the dominant egress cost and tripped
   * slow clients' backpressure kill exactly when frames were biggest; the client
   * already unions samples via mergeWallHistory, so the tail is all it needs.
   */
  latestDeltaFrame: string | null;
  timer: ReturnType<typeof setInterval> | null;
  refreshInFlight: boolean;
};

const hubs = new Map<string, TickerHub>();
let totalStreams = 0;

function hubFor(ticker: string): TickerHub {
  const t = normalizeVectorTicker(ticker);
  let hub = hubs.get(t);
  if (!hub) {
    hub = {
      subscribers: 0,
      latestFullFrame: null,
      latestDeltaFrame: null,
      timer: null,
      refreshInFlight: false,
    };
    hubs.set(t, hub);
  }
  return hub;
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function refreshTickerHub(ticker: string): Promise<void> {
  const t = normalizeVectorTicker(ticker);
  const hub = hubs.get(t);
  if (!hub || hub.refreshInFlight) return;
  hub.refreshInFlight = true;
  try {
    const payload: VectorStreamPayload = await buildVectorStreamPayload(t);
    hub.latestFullFrame = frame(payload);
    const tail = payload.wallHistory[payload.wallHistory.length - 1];
    hub.latestDeltaFrame = frame({ ...payload, wallHistory: tail ? [tail] : [] });
  } catch {
    /* keep previous frames on transient error */
  } finally {
    hub.refreshInFlight = false;
  }
}

function startTickerPoller(ticker: string): void {
  const t = normalizeVectorTicker(ticker);
  const hub = hubFor(t);
  if (hub.timer) return;
  void refreshTickerHub(t);
  hub.timer = setInterval(() => {
    void refreshTickerHub(t);
  }, TICK_MS);
  (hub.timer as unknown as { unref?: () => void }).unref?.();
}

function stopTickerPollerIfIdle(ticker: string): void {
  const t = normalizeVectorTicker(ticker);
  const hub = hubs.get(t);
  if (!hub || hub.subscribers > 0) return;
  if (hub.timer) {
    clearInterval(hub.timer);
    hub.timer = null;
  }
  hubs.delete(t);
}

/** Register a viewer for `ticker`; starts the shared 1 Hz poller when first subscriber connects. */
export function attachVectorStreamSubscriber(ticker: string): void {
  const t = normalizeVectorTicker(ticker);
  const hub = hubFor(t);
  hub.subscribers += 1;
  startTickerPoller(t);
}

/** Drop a viewer; stops the poller when the last subscriber for this ticker disconnects. */
export function detachVectorStreamSubscriber(ticker: string): void {
  const t = normalizeVectorTicker(ticker);
  const hub = hubs.get(t);
  if (!hub) return;
  hub.subscribers = Math.max(0, hub.subscribers - 1);
  stopTickerPollerIfIdle(t);
}

/**
 * Atomically claim a connection slot under the cap. The old pattern (read count
 * in the route, increment later inside stream start) was a check-then-act race —
 * concurrent connects could overshoot MAX_STREAMS.
 */
export function tryAcquireVectorStreamConnection(maxStreams: number): boolean {
  if (totalStreams >= maxStreams) return false;
  totalStreams += 1;
  return true;
}

export function releaseVectorStreamConnection(): void {
  totalStreams = Math.max(0, totalStreams - 1);
}

export function vectorStreamConnectionCount(): number {
  return totalStreams;
}

/** Latest full-history SSE frame (connection's first frame). Null until first refresh. */
export function getVectorStreamFullFrame(ticker: string): string | null {
  return hubs.get(normalizeVectorTicker(ticker))?.latestFullFrame ?? null;
}

/** Latest tail-only SSE frame (steady-state). Null until first refresh. */
export function getVectorStreamDeltaFrame(ticker: string): string | null {
  return hubs.get(normalizeVectorTicker(ticker))?.latestDeltaFrame ?? null;
}

/** Test-only reset. */
export function _resetVectorStreamHubForTest(): void {
  for (const hub of hubs.values()) {
    if (hub.timer) clearInterval(hub.timer);
  }
  hubs.clear();
  totalStreams = 0;
}
