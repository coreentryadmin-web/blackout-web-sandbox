/**
 * Per-ticker Vector SSE fan-out — one payload build per second per ticker, shared by
 * all connections watching that symbol. Mirrors spx/pulse/stream shared refresher pattern.
 */
import { buildVectorStreamPayload } from "./vector-snapshot";
import { normalizeVectorTicker } from "./vector-ticker";

const TICK_MS = 1_000;

type TickerHub = {
  subscribers: number;
  latestFrame: string | null;
  timer: ReturnType<typeof setInterval> | null;
  refreshInFlight: boolean;
};

const hubs = new Map<string, TickerHub>();
let totalStreams = 0;

function hubFor(ticker: string): TickerHub {
  const t = normalizeVectorTicker(ticker);
  let hub = hubs.get(t);
  if (!hub) {
    hub = { subscribers: 0, latestFrame: null, timer: null, refreshInFlight: false };
    hubs.set(t, hub);
  }
  return hub;
}

async function refreshTickerHub(ticker: string): Promise<void> {
  const t = normalizeVectorTicker(ticker);
  const hub = hubs.get(t);
  if (!hub || hub.refreshInFlight) return;
  hub.refreshInFlight = true;
  try {
    const payload = await buildVectorStreamPayload(t);
    hub.latestFrame = `data: ${JSON.stringify(payload)}\n\n`;
  } catch {
    /* keep previous frame on transient error */
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

export function acquireVectorStreamConnection(): void {
  totalStreams += 1;
}

export function releaseVectorStreamConnection(): void {
  totalStreams = Math.max(0, totalStreams - 1);
}

export function vectorStreamConnectionCount(): number {
  return totalStreams;
}

/** Latest serialized SSE frame for a ticker (null until first refresh completes). */
export function getVectorStreamFrame(ticker: string): string | null {
  return hubs.get(normalizeVectorTicker(ticker))?.latestFrame ?? null;
}

/** Test-only reset. */
export function _resetVectorStreamHubForTest(): void {
  for (const hub of hubs.values()) {
    if (hub.timer) clearInterval(hub.timer);
  }
  hubs.clear();
  totalStreams = 0;
}
