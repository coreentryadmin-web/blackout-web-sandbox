"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import type { AdminHealthPayload } from "@/lib/admin-health";

export function AdminHealthBanner() {
  const [health, setHealth] = useState<AdminHealthPayload | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/health", { cache: "no-store" });
      if (!res.ok) throw new Error("health failed");
      setHealth(await res.json());
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

  const tone =
    health.counts.critical > 0 ? "critical" : health.counts.warning > 0 ? "warn" : "ok";

  const label =
    health.counts.critical > 0
      ? "DEGRADED"
      : health.counts.warning > 0
        ? "CAUTION"
        : "OK";

  return (
    <div className={clsx("admin-health-banner", `admin-health-banner-${tone}`)}>
      <span className="admin-health-banner-label">SYSTEM</span>
      <span className="admin-health-banner-value">{label}</span>
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
