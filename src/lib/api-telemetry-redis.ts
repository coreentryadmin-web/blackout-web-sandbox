import type { ApiProviderId } from "@/lib/api-telemetry-types";
import { getApiTelemetrySnapshot, getProviderHealthSummary } from "@/lib/api-telemetry";

const TELEMETRY_TTL_SEC = 120;
const FLUSH_MS = 10_000;
const INSTANCE_SET_KEY = "telemetry:instances";

type InstanceTelemetryPayload = {
  instance_id: string;
  updated_at: string;
  rate_limits: Partial<Record<ApiProviderId, number>>;
  providers: Partial<
    Record<
      ApiProviderId,
      {
        calls_5m: number;
        errors_5m: number;
        last_at: string | null;
        last_status: number | null;
        last_ok: boolean;
      }
    >
  >;
};

let flushTimer: ReturnType<typeof setInterval> | null = null;

// Singleton Redis client — created once and reused across all flush calls.
let _redisClient: import("ioredis").default | null = null;
let _redisClientInit: Promise<import("ioredis").default | null> | null = null;

function instanceId(): string {
  return (
    process.env.RAILWAY_REPLICA_ID?.trim() ||
    process.env.HOSTNAME?.trim() ||
    `pid-${process.pid}`
  );
}

function telemetryInstanceKey(id: string): string {
  return `telemetry:instance:${id}`;
}

async function redisClient() {
  if (_redisClient) return _redisClient;
  if (_redisClientInit) return _redisClientInit;

  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;

  _redisClientInit = (async () => {
    try {
      const mod = await import("ioredis");
      const Redis = mod.default;
      const client = new Redis(url, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectTimeout: 2_000,
      });
      // Without an 'error' listener, ioredis throws on the EventEmitter when the
      // connection drops post-connect — which crashes the whole process/replica.
      client.on("error", (err) => console.warn("[api-telemetry-redis] redis error:", err instanceof Error ? err.message : err));
      await client.connect();
      _redisClient = client;
      return client;
    } catch {
      _redisClientInit = null; // allow retry on next call
      return null;
    }
  })();

  return _redisClientInit;
}

function buildInstancePayload(): InstanceTelemetryPayload {
  const snap = getApiTelemetrySnapshot(5 * 60_000);
  const health = getProviderHealthSummary(5 * 60_000);
  const providers: InstanceTelemetryPayload["providers"] = {};

  for (const [provider, row] of Object.entries(health.by_provider)) {
    providers[provider as ApiProviderId] = {
      calls_5m: row.calls_5m,
      errors_5m: row.errors_5m,
      last_at: row.last_at,
      last_status: row.last_status,
      last_ok: row.last_ok,
    };
  }

  return {
    instance_id: instanceId(),
    updated_at: new Date().toISOString(),
    rate_limits: health.rate_limits,
    providers,
  };
}

export function scheduleTelemetryRedisFlush(): void {
  if (flushTimer || !process.env.REDIS_URL?.trim()) return;
  flushTimer = setInterval(() => {
    void flushTelemetryToRedis();
  }, FLUSH_MS);
  void flushTelemetryToRedis();
}

export async function flushTelemetryToRedis(): Promise<void> {
  const client = await redisClient();
  if (!client) return;

  const id = instanceId();
  const payload = buildInstancePayload();
  const key = `blackout:${telemetryInstanceKey(id)}`;

  try {
    await client.set(key, JSON.stringify(payload), "EX", TELEMETRY_TTL_SEC);
    await client.sadd(`blackout:${INSTANCE_SET_KEY}`, id);
    await client.expire(`blackout:${INSTANCE_SET_KEY}`, TELEMETRY_TTL_SEC * 2);
  } catch {
    /* ignore */
  }
}

export async function readCrossInstanceTelemetry(): Promise<{
  instances_reporting: number;
  rate_limits: Partial<Record<ApiProviderId, number>>;
  providers: Partial<Record<ApiProviderId, { calls_5m: number; errors_5m: number }>>;
} | null> {
  const client = await redisClient();
  if (!client) return null;

  try {
    const ids = await client.smembers(`blackout:${INSTANCE_SET_KEY}`);
    if (!ids.length) return null;

    const keys = ids.map((id) => `blackout:${telemetryInstanceKey(id)}`);
    const rawRows = await client.mget(...keys);

    const rate_limits: Partial<Record<ApiProviderId, number>> = {};
    const providers: Partial<Record<ApiProviderId, { calls_5m: number; errors_5m: number }>> = {};
    let reporting = 0;

    for (const raw of rawRows) {
      if (!raw) continue;
      try {
        const row = JSON.parse(raw) as InstanceTelemetryPayload;
        reporting += 1;
        for (const [provider, count] of Object.entries(row.rate_limits ?? {})) {
          const p = provider as ApiProviderId;
          rate_limits[p] = (rate_limits[p] ?? 0) + (count ?? 0);
        }
        for (const [provider, stats] of Object.entries(row.providers ?? {})) {
          const p = provider as ApiProviderId;
          const prev = providers[p] ?? { calls_5m: 0, errors_5m: 0 };
          providers[p] = {
            calls_5m: prev.calls_5m + (stats?.calls_5m ?? 0),
            errors_5m: prev.errors_5m + (stats?.errors_5m ?? 0),
          };
        }
      } catch {
        /* skip bad row */
      }
    }

    return { instances_reporting: reporting, rate_limits, providers };
  } catch {
    return null;
  }
}
