type RedisClient = import("ioredis").default;

let publisher: RedisClient | null = null;
let subscriber: RedisClient | null = null;
let publisherReady = false;
let subscriberReady = false;
let publisherInit: Promise<RedisClient | null> | null = null;
let subscriberInit: Promise<RedisClient | null> | null = null;
// Track last failure time instead of a permanent flag; retry after RETRY_BACKOFF_MS.
const RETRY_BACKOFF_MS = 30_000;
let publisherLastFailedAt = 0;
let subscriberLastFailedAt = 0;

const channelHandlers = new Map<string, Set<(message: string) => void>>();

function redisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url || null;
}

async function connectPublisher(): Promise<RedisClient | null> {
  if (publisherLastFailedAt && Date.now() - publisherLastFailedAt < RETRY_BACKOFF_MS) return null;
  if (publisher && publisherReady) return publisher;
  if (publisherInit) return publisherInit;

  const url = redisUrl();
  if (!url) return null;

  publisherInit = (async () => {
    try {
      const mod = await import("ioredis");
      const Redis = mod.default;
      const client = new Redis(url, {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        connectTimeout: 2_000,
      });
      // Without an 'error' listener, ioredis throws on the EventEmitter when the
      // connection drops post-connect — which crashes the whole process/replica.
      client.on("error", (err) => console.warn("[redis-pubsub] redis error:", err instanceof Error ? err.message : err));
      await client.connect();
      publisher = client;
      publisherReady = true;
      publisherLastFailedAt = 0; // clear failure on success
      return client;
    } catch (err) {
      publisherLastFailedAt = Date.now();
      publisherInit = null; // allow retry after backoff
      console.warn("[redis-pubsub] publisher unavailable", err);
      return null;
    }
  })();

  return publisherInit;
}

async function connectSubscriber(): Promise<RedisClient | null> {
  if (subscriberLastFailedAt && Date.now() - subscriberLastFailedAt < RETRY_BACKOFF_MS) return null;
  if (subscriber && subscriberReady) return subscriber;
  if (subscriberInit) return subscriberInit;

  const url = redisUrl();
  if (!url) return null;

  subscriberInit = (async () => {
    try {
      const mod = await import("ioredis");
      const Redis = mod.default;
      const client = new Redis(url, {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        connectTimeout: 2_000,
      });
      // Without an 'error' listener, ioredis throws on the EventEmitter when the
      // connection drops post-connect — which crashes the whole process/replica.
      client.on("error", (err) => console.warn("[redis-pubsub] redis error:", err instanceof Error ? err.message : err));
      await client.connect();
      client.on("message", (channel, message) => {
        channelHandlers.get(channel)?.forEach((handler) => {
          try {
            handler(message);
          } catch {
            /* ignore */
          }
        });
      });
      subscriber = client;
      subscriberReady = true;
      subscriberLastFailedAt = 0; // clear failure on success
      return client;
    } catch (err) {
      subscriberLastFailedAt = Date.now();
      subscriberInit = null; // allow retry after backoff
      console.warn("[redis-pubsub] subscriber unavailable", err);
      return null;
    }
  })();

  return subscriberInit;
}

export async function redisPublish(channel: string, message: string): Promise<boolean> {
  const client = await connectPublisher();
  if (!client) return false;
  try {
    await client.publish(channel, message);
    return true;
  } catch {
    return false;
  }
}

export async function redisSubscribe(
  channel: string,
  handler: (message: string) => void
): Promise<() => void> {
  if (!channelHandlers.has(channel)) channelHandlers.set(channel, new Set());
  channelHandlers.get(channel)!.add(handler);

  const client = await connectSubscriber();
  if (client) {
    try {
      await client.subscribe(channel);
    } catch {
      /* local-only */
    }
  }

  return () => {
    const handlers = channelHandlers.get(channel);
    if (!handlers) return;
    handlers.delete(handler);
    // Only tear down the Redis subscription when the LAST local handler for this
    // channel is gone — otherwise we'd stop delivering messages to siblings.
    if (handlers.size === 0) {
      channelHandlers.delete(channel);
      // Best-effort UNSUBSCRIBE: use the existing connected client only (do not
      // spin up a connection just to unsubscribe). Fire-and-forget; never throw
      // from the cleanup callback.
      if (subscriber && subscriberReady) {
        void subscriber.unsubscribe(channel).catch(() => {
          /* local-only / connection gone */
        });
      }
    }
  };
}

export function getRedisPubSubStatus() {
  return {
    configured: Boolean(redisUrl()),
    publisher_ready: publisherReady,
    subscriber_ready: subscriberReady,
    subscribed_channels: Array.from(channelHandlers.keys()),
  };
}
