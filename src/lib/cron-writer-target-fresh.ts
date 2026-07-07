/** REST flow-ingest skip reasons that mean an alternate live writer path is active. */
export const FLOW_INGEST_ALT_SKIP_REASONS = new Set(["ws_active", "ws_active_cluster", "bot_primary"]);

export function isFlowIngestAlternateWriterSkip(message: string | null | undefined): boolean {
  return FLOW_INGEST_ALT_SKIP_REASONS.has(String(message ?? "").trim());
}

export type WriterTargetProbe = { fresh: boolean; detail: string };

/** PG downstream target for flow-ingest — true when flow_alerts landed within `maxAgeMin`. */
export async function probePgFlowAlertsFresh(
  maxAgeMin = 20
): Promise<{ fresh: boolean; ageMin: number | null }> {
  const { dbConfigured, dbQuery } = await import("@/lib/db");
  if (!dbConfigured()) return { fresh: false, ageMin: null };
  try {
    const res = await dbQuery<{ latest_ms: string | null }>(
      `SELECT (EXTRACT(EPOCH FROM MAX(COALESCE(created_at, inserted_at))) * 1000)::bigint AS latest_ms
       FROM flow_alerts`
    );
    const ms = res.rows[0]?.latest_ms != null ? Number(res.rows[0].latest_ms) : NaN;
    if (!Number.isFinite(ms)) return { fresh: false, ageMin: null };
    const ageMin = (Date.now() - ms) / 60_000;
    return { fresh: ageMin <= maxAgeMin, ageMin };
  } catch {
    return { fresh: false, ageMin: null };
  }
}

function ageMinFromIso(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return (now - ms) / 60_000;
}

async function uwCacheRemainingTtlSec(logicalKey: string): Promise<number | null> {
  const { getUwCacheRedis } = await import("@/lib/providers/uw-shared-cache");
  const redis = await getUwCacheRedis();
  if (!redis) return null;
  try {
    const client = redis as { ttl?: (key: string) => Promise<number> };
    if (typeof client.ttl !== "function") return null;
    const ttl = await client.ttl(`uw_cache:${logicalKey}`);
    return Number.isFinite(ttl) ? ttl : null;
  } catch {
    return null;
  }
}

/**
 * True when the writer's authoritative target (PG/Redis) is fresh during RTH, even if the
 * cron handshake row is old. Returns null when the job has no probe (caller keeps verdict).
 */
export async function probeWriterTargetFresh(jobKey: string): Promise<WriterTargetProbe | null> {
  switch (jobKey) {
    case "flow-ingest": {
      const pg = await probePgFlowAlertsFresh(20);
      if (pg.fresh) {
        return {
          fresh: true,
          detail: `flow_alerts latest row ${pg.ageMin != null ? `${pg.ageMin.toFixed(1)}m` : "?"} ago`,
        };
      }
      const { isFlowFrameFreshAnywhere } = await import("@/lib/flow-liveness");
      const fresh = await isFlowFrameFreshAnywhere(120_000);
      return {
        fresh,
        detail: fresh
          ? "cluster UW flow WS heartbeat fresh (REST cron intentionally idle)"
          : `no recent PG flow_alerts row${pg.ageMin != null ? ` (${pg.ageMin.toFixed(0)}m old)` : ""} or cluster WS heartbeat`,
      };
    }
    case "heatmap-warm": {
      const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
      let pos: Awaited<ReturnType<typeof getGexPositioning>> = null;
      try {
        pos = await getGexPositioning("SPX");
      } catch {
        pos = null;
      }
      if (!pos) return { fresh: false, detail: "gex-heatmap:SPX cache cold" };
      const ageMin = ageMinFromIso(pos.asof);
      const fresh = ageMin != null && ageMin <= 15;
      return {
        fresh,
        detail: `gex-heatmap:SPX asof ${ageMin != null ? `${ageMin.toFixed(1)}m` : "?"} ago`,
      };
    }
    case "desk-warm": {
      const { loadSpxDesk } = await import("@/lib/spx-desk-loader");
      try {
        const desk = await loadSpxDesk();
        const ageMin = ageMinFromIso(desk.polled_at ?? desk.as_of);
        const fresh = ageMin != null && ageMin <= 2;
        return {
          fresh,
          detail: `spx-desk asof ${ageMin != null ? `${ageMin.toFixed(1)}m` : "?"} ago`,
        };
      } catch {
        return { fresh: false, detail: "spx-desk cache cold" };
      }
    }
    case "grid-warm": {
      const { GRID_KEYS } = await import("@/lib/providers/grid");
      const { getUwCacheRedis } = await import("@/lib/providers/uw-shared-cache");
      const redis = await getUwCacheRedis();
      if (!redis) return null;
      try {
        const raw = await redis.get(`uw_cache:${GRID_KEYS.analysts}`);
        if (!raw) return { fresh: false, detail: "grid:analysts cache miss" };
        const parsed = JSON.parse(raw) as { as_of?: string };
        const ageMin = ageMinFromIso(parsed.as_of);
        const ttl = await uwCacheRemainingTtlSec(GRID_KEYS.analysts);
        const fresh =
          (ageMin != null && ageMin <= 15) || (ttl != null && ttl > 0 && ttl <= 900);
        return {
          fresh,
          detail: `grid:analysts asof ${ageMin != null ? `${ageMin.toFixed(1)}m` : "?"} ago${ttl != null ? `, ttl ${ttl}s` : ""}`,
        };
      } catch {
        return { fresh: false, detail: "grid:analysts probe failed" };
      }
    }
    case "uw-cache-refresh": {
      const { UW_KEYS } = await import("@/lib/providers/uw-shared-cache");
      const key = UW_KEYS.marketTide();
      const ttl = await uwCacheRemainingTtlSec(key);
      if (ttl == null) return null;
      const fresh = ttl > 0;
      return {
        fresh,
        detail: fresh ? `uw_cache:${key} ttl ${ttl}s remaining` : `uw_cache:${key} expired/missing`,
      };
    }
  }
  return null;
}
