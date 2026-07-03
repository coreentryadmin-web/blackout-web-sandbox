"use client";

import useSWR from "swr";
import type { AdminHealthPayload } from "@/lib/admin-health";
import type { CronHealthPayload } from "@/lib/admin-cron-health";
import type { AdminIncidentRow } from "@/lib/admin-incidents";

// ---------------------------------------------------------------------------
// Shared admin data fetchers. Before this, /api/admin/health was independently
// polled by 3 components (AdminHealthBanner, AdminOperationsDashboard,
// AdminApiDashboard), /api/admin/cron-health by 2 (AdminHealthBanner,
// AdminCronDashboard), /api/admin/incidents by 2 (AdminOperationsDashboard,
// AdminSpxTerminal) — each with its own useState/useEffect/setInterval poll
// loop, at slightly different cadences. SWR dedupes by key: every consumer
// calling the SAME hook shares ONE underlying fetch/poll cycle and cache
// entry, so N components reading the same data cost ONE request, not N.
// See docs/bie/DESIGN-NOTES.md's admin-remodel notes for the fuller audit.
// ---------------------------------------------------------------------------

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
};

/** System health: SPX/provider vitals, error counts, route errors, rate limiters.
 *  Every consumer shares the same SWR cache key regardless of its own refreshInterval —
 *  SWR dedupes concurrent revalidations, so a faster consumer (e.g. a live rate-limiter
 *  tile) doesn't cost a separate poll loop, it just raises the effective refresh rate
 *  for everyone reading this key. */
export function useAdminHealth(refreshInterval = 15_000) {
  return useSWR<AdminHealthPayload>("/api/admin/health", fetchJson, {
    refreshInterval,
    revalidateOnFocus: false,
  });
}

/** Per-job cron staleness/summary — the same schedule-aware engine every consumer needs. */
export function useAdminCronHealth() {
  return useSWR<CronHealthPayload>("/api/admin/cron-health", fetchJson, {
    refreshInterval: 15_000,
    revalidateOnFocus: false,
  });
}

/** Open admin incidents (auto-opened by data-integrity + manually filed). */
export function useAdminIncidents() {
  return useSWR<{ incidents: AdminIncidentRow[]; generated_at: string }>(
    "/api/admin/incidents",
    fetchJson,
    { refreshInterval: 20_000, revalidateOnFocus: false }
  );
}
