// BLACKOUT Intelligence Engine — Layer 5 diagnostic Redis health probe.
// Read-only, isolated from the app's actual caching path: its own short-lived
// client (same pattern as uw-shared-cache.ts's dedicated client, NOT the
// general-purpose shared-cache.ts client) so a diagnostic probe can never
// contend with real cache traffic or leak an extra always-on connection.

/** Pure parser for Redis INFO's `key: value\r\n` blob — no ioredis dependency, unit-testable. */
export function parseRedisInfo(info: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of info.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

export type RedisHealth =
  | { configured: false }
  | { configured: true; connected: false; error: string }
  | {
      configured: true;
      connected: true;
      used_memory_mb: number;
      connected_clients: number;
      uptime_hours: number;
      keys: number;
    };

/** One-shot probe: connect, INFO + DBSIZE, disconnect. Never held open — this
 *  is a diagnostic check, not a cache client. */
export async function probeRedisHealth(): Promise<RedisHealth> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return { configured: false };
  let client: import("ioredis").default | null = null;
  try {
    const { makeRedis } = await import("./make-redis");
    client = await makeRedis("bie-redis-probe", url, { maxRetriesPerRequest: 1, connectTimeoutMs: 3_000 });
    const [info, keys] = await Promise.all([client.info(), client.dbsize()]);
    const fields = parseRedisInfo(info);
    return {
      configured: true,
      connected: true,
      used_memory_mb: Math.round((Number(fields.used_memory) || 0) / 1024 / 1024),
      connected_clients: Number(fields.connected_clients) || 0,
      uptime_hours: Math.round(((Number(fields.uptime_in_seconds) || 0) / 3600) * 10) / 10,
      keys,
    };
  } catch (e) {
    return { configured: true, connected: false, error: e instanceof Error ? e.message : "probe failed" };
  } finally {
    client?.disconnect();
  }
}
