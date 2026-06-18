import type { ApiProviderId } from "@/lib/api-telemetry-types";

export type RateQuotaSpec = {
  per_minute: number;
  label: string;
};

/** Documented / configured burst limits for headroom display (not provider-enforced here). */
export const PROVIDER_RATE_QUOTAS: Partial<Record<ApiProviderId, RateQuotaSpec>> = {
  unusual_whales: { per_minute: 120, label: "UW Advanced burst" },
  polygon: { per_minute: 100, label: "Massive REST (plan est.)" },
  finnhub: { per_minute: 60, label: "Finnhub free tier" },
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
