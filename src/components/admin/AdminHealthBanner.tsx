"use client";

import { clsx } from "clsx";
import { useAdminHealth, useAdminCronHealth } from "@/hooks/use-admin-data";

export function AdminHealthBanner() {
  // Cron health is read alongside the SPX/provider health so a market-hours cron stale during
  // RTH (#90) surfaces in the always-visible system banner, not just on the cron dashboard tab.
  // Both hooks are shared (SWR, keyed by URL) with every other admin panel that reads the same
  // data — this banner no longer runs its own independent poll loop.
  const { data: health, error: healthError } = useAdminHealth();
  const { data: cron } = useAdminCronHealth();

  if (healthError && !health) {
    return (
      <div className="admin-health-banner admin-health-banner-warn">
        <span className="admin-health-banner-label">SYSTEM</span>
        <span className="admin-health-banner-value">HEALTH UNAVAILABLE</span>
      </div>
    );
  }

  if (!health) return null;

  const rthStale = cron?.summary.market_hours_stale ?? 0;
  // An RTH-stale market-hours cron is a live-data emergency — escalate the banner to critical even
  // if SPX/provider health is otherwise clean (this is the #90 case that previously went silent).
  const hasCritical = health.counts.critical > 0 || rthStale > 0;

  const tone = hasCritical ? "critical" : health.counts.warning > 0 ? "warn" : "ok";

  const label = hasCritical ? "DEGRADED" : health.counts.warning > 0 ? "CAUTION" : "OK";

  return (
    <div className={clsx("admin-health-banner", `admin-health-banner-${tone}`)}>
      <span className="admin-health-banner-label">SYSTEM</span>
      <span className="admin-health-banner-value">{label}</span>
      {rthStale > 0 && (
        <span className="admin-health-banner-chip admin-health-banner-chip-critical">
          {rthStale} CRON STALE (RTH)
        </span>
      )}
      {health.counts.critical > 0 && (
        <span className="admin-health-banner-chip admin-health-banner-chip-critical">
          {health.counts.critical} CRITICAL
        </span>
      )}
      {health.counts.warning > 0 && (
        <span className="admin-health-banner-chip admin-health-banner-chip-warn">
          {health.counts.warning} WARNING
        </span>
      )}
      {health.counts.api_errors > 0 && (
        <span className="admin-health-banner-chip admin-health-banner-chip-api">
          {health.counts.api_errors} API ERR
        </span>
      )}
      {health.route_errors.length > 0 && (
        <span className="admin-health-banner-chip admin-health-banner-chip-warn">
          {health.route_errors.length} ROUTE ERR
        </span>
      )}
    </div>
  );
}
