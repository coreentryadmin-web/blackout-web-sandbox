type RedisClient = import("ioredis").default;

let publisher: RedisClient | null = null;
let subscriber: RedisClient | null = null;
let publisherReady = false;
let subscriberReady = false;
let publisherInit: Promise<RedisClient | null> | null = null;
let subscriberInit: Promise<RedisClient | null> | null = null;
// Track last failure time instead of a permanent flag; retry after RETRY_BACKOFF_MS.
const RETRY_BACKOFF_MS = 30_000;
let lastFailedAt = 0;

const channelHandlers = new Map<string, Set<(message: string) => void>>();

function redisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url || null;
}

async function connectPublisher(): Promise<RedisClient | null> {
  if (lastFailedAt && Date.now() - lastFailedAt < RETRY_BACKOFF_MS) return null;
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
      await client.connect();
      publisher = client;
      publisherReady = true;
      lastFailedAt = 0; // clear failure on success
      return client;
    } catch (err) {
      lastFailedAt = Date.now();
      publisherInit = null; // allow retry after backoff
      console.warn("[redis-pubsub] publisher unavailable", err);
      return null;
    }
  })();

  return publisherInit;
}

async function connectSubscriber(): Promise<RedisClient | null> {
  if (lastFailedAt && Date.now() - lastFailedAt < RETRY_BACKOFF_MS) return null;
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
      lastFailedAt = 0; // clear failure on success
      return client;
    } catch (err) {
      lastFailedAt = Date.now();
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
    channelHandlers.get(channel)?.delete(handler);
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
