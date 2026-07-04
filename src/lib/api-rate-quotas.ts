import type { ApiProviderId } from "@/lib/api-telemetry-types";

export type RateQuotaSpec = {
  per_minute: number;
  label: string;
};

/** Documented / configured burst limits for headroom display (not provider-enforced here). */
export const PROVIDER_RATE_QUOTAS: Partial<Record<ApiProviderId, RateQuotaSpec>> = {
  unusual_whales: { per_minute: 120, label: "UW Advanced burst" },
  polygon: { per_minute: 100, label: "Massive REST (plan est.)" },
  anthropic: { per_minute: 50, label: "Claude API (est.)" },
};

export type RateQuotaHeadroom = {
  provider: ApiProviderId;
  label: string;
  used_1m: number;
  limit_1m: number;
  pct: number;
  headroom: number;
  status: "ok" | "warn" | "critical";
};

/**
 * Convert the cluster-wide 5-minute rollup into a per-minute-equivalent call count keyed by
 * provider, for feeding buildRateQuotaHeadroom(). A single replica's own in-memory counter only
 * sees the calls THAT replica made, so on a multi-replica deploy it reads ~1/REPLICA_COUNT of
 * true usage and can show "ok" headroom right up to an actual cluster-wide rate-limit event.
 * Falls back to the caller-supplied local counts when cross-instance telemetry is unavailable
 * (e.g. Redis down) — degraded but non-null.
 */
export function deriveClusterCallsByProvider1m(
  clusterProviders: Partial<Record<ApiProviderId, { calls_5m: number; errors_5m: number }>> | null | undefined,
  localCallsByProvider1m: Partial<Record<ApiProviderId, number>>
): Partial<Record<ApiProviderId, number>> {
  if (!clusterProviders) return localCallsByProvider1m;
  return Object.fromEntries(
    Object.entries(clusterProviders).map(([provider, stats]) => [
      provider,
      Math.round((stats?.calls_5m ?? 0) / 5),
    ])
  ) as Partial<Record<ApiProviderId, number>>;
}

export function buildRateQuotaHeadroom(
  callsByProvider1m: Partial<Record<ApiProviderId, number>>
): RateQuotaHeadroom[] {
  const out: RateQuotaHeadroom[] = [];
  for (const [provider, spec] of Object.entries(PROVIDER_RATE_QUOTAS) as [
    ApiProviderId,
    RateQuotaSpec,
  ][]) {
    const used = callsByProvider1m[provider] ?? 0;
    const pct = spec.per_minute > 0 ? Math.round((used / spec.per_minute) * 100) : 0;
    const headroom = Math.max(0, spec.per_minute - used);
    const status = pct >= 90 ? "critical" : pct >= 70 ? "warn" : "ok";
    out.push({
      provider,
      label: spec.label,
      used_1m: used,
      limit_1m: spec.per_minute,
      pct,
      headroom,
      status,
    });
  }
  return out.sort((a, b) => b.pct - a.pct);
}
