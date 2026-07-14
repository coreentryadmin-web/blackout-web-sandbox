/**
 * GEX Matrix Delta Broadcast Channel
 *
 * Server-side SSE subscription manager for real-time matrix delta broadcasts.
 * When the heatmap-warm cron fires, it calls broadcastMatrixDelta() which pushes
 * updates to all active subscribers (clients with open SSE connections to /api/market/gex-matrix-deltas).
 */

import type { MatrixDelta } from "./gex-matrix-delta";

type SubscriberWriter = {
  write: (data: string) => Promise<void>;
};

const subscribers = new Set<SubscriberWriter>();

// Safety limits to prevent memory leaks
const MAX_SUBSCRIBERS = 10000;
const SUBSCRIBER_TTL_MS = 30 * 60 * 1000; // 30 min auto-cleanup

/**
 * Broadcast a matrix delta to all active SSE subscribers.
 * Best-effort: dead subscribers are automatically removed.
 */
export async function broadcastMatrixDelta(delta: MatrixDelta) {
  const payload = `data: ${JSON.stringify(delta)}\n\n`;
  const deadSubscribers: SubscriberWriter[] = [];

  for (const writer of subscribers) {
    try {
      await writer.write(payload);
    } catch (err) {
      // Subscriber dead (network error, connection closed)
      deadSubscribers.push(writer);
    }
  }

  // Cleanup dead connections
  for (const dead of deadSubscribers) {
    subscribers.delete(dead);
  }
}

/**
 * Register a new SSE subscriber.
 * Returns an unsubscribe function.
 */
export function subscribeMatrixDeltas(writer: SubscriberWriter): () => void {
  // Bound subscribers to prevent unbounded growth
  if (subscribers.size >= MAX_SUBSCRIBERS) {
    console.warn(
      `[gex-matrix-broadcast] Max subscribers (${MAX_SUBSCRIBERS}) reached, dropping old connection`
    );
    const first = subscribers.values().next().value;
    if (first) subscribers.delete(first);
  }

  subscribers.add(writer);

  // Auto-cleanup if subscriber doesn't close within TTL
  const timeout = setTimeout(() => {
    subscribers.delete(writer);
  }, SUBSCRIBER_TTL_MS);

  // Return unsubscribe function
  return () => {
    clearTimeout(timeout);
    subscribers.delete(writer);
  };
}

/**
 * Get current subscriber count (for monitoring).
 */
export function getSubscriberCount(): number {
  return subscribers.size;
}

/**
 * Clear all subscribers (used in tests).
 */
export function clearSubscribers(): void {
  subscribers.clear();
}
