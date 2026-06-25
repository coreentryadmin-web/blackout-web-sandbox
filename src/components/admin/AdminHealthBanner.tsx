"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import type { AdminHealthPayload } from "@/lib/admin-health";
import type { CronHealthPayload } from "@/lib/admin-cron-health";

export function AdminHealthBanner() {
  const [health, setHealth] = useState<AdminHealthPayload | null>(null);
  // Cron health is fetched alongside the SPX/provider health so a market-hours cron stale during
  // RTH (#90) surfaces in the always-visible system banner, not just on the cron dashboard tab.
  const [cron, setCron] = useState<CronHealthPayload | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [healthRes, cronRes] = await Promise.all([
        fetch("/api/admin/health", { cache: "no-store" }),
        fetch("/api/admin/cron-health", { cache: "no-store" }).catch(() => null),
      ]);
      if (!healthRes.ok) throw new Error("health failed");
      setHealth(await healthRes.json());
      // Cron health is best-effort: a failure here must not blank the whole banner.
      if (cronRes && cronRes.ok) {
        setCron(await cronRes.json());
      }
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  if (error && !health) {
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
