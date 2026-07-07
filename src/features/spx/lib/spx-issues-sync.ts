import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { buildPlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { readSpxPlaySnapshot } from "@/features/spx/lib/spx-evaluator";
import { buildSpxAdminIssues, type SpxAdminIssuesPayload } from "@/lib/admin-spx-issues";
import { syncAdminIncidents } from "@/lib/admin-incidents";

/**
 * Namespace this reconciler owns for the auto-resolve step — everything EXCEPT
 * `data-integrity*`, which is owned by the data-integrity cron's own reconcile (see
 * `syncAdminIncidents`'s `resolveScope` doc in admin-incidents.ts). Exported so every
 * caller that reconciles this same issue set (today: this cron + the admin SPX
 * dashboard's fetchSpxAdminDashboard) shares one literal instead of two copies of the
 * same `!cat.startsWith("data-integrity")` predicate silently drifting apart.
 */
export const SPX_ISSUES_RESOLVE_SCOPE = (category: string): boolean =>
  !category.startsWith("data-integrity");

/**
 * Computes SPX play/engine health issues (Claude arbiter vetoes, gate blocks/warnings
 * under category:"play"; play-engine heartbeat silent/stale under category:"engine",
 * plus the desk/provider/websocket/db issues admin-spx-issues.ts also derives) and
 * persists them into the shared `admin_incidents` table via `syncAdminIncidents`, so
 * BIE's discovery layer (`fetchDiscoveryIncidents` in `src/lib/bie/discovery.ts`) sees
 * current SPX engine health without depending on a human viewing
 * `/api/admin/spx/dashboard` (the only previous caller of this exact sequence — see
 * `fetchSpxAdminDashboard` in admin-spx-dashboard.ts, and the FINDINGS.md entry for
 * this fix for why that page-view-gated sync was a production blind spot).
 *
 * Extracted out of fetchSpxAdminDashboard() rather than having the new cron route
 * self-call the dashboard's HTTP endpoint: `buildSpxAdminIssues` and
 * `syncAdminIncidents` were already plain importable functions, so the only thing
 * missing was this glue (load desk → build a READ-ONLY play snapshot → build issues →
 * sync) — no need for an internal HTTP round trip, and this skips the dashboard's
 * unrelated analytics/lotto/terminal-feed work the cron doesn't need.
 *
 * Uses `readSpxPlaySnapshot` (mutate:false) — the same read-only snapshot the admin
 * dashboard's `?live=1` dry-run view uses — so this never writes play state, never
 * fires Discord, and never advances `recordPlayEngineTick` (that heartbeat stays owned
 * exclusively by the mutating `runSpxEvaluator` in the spx-evaluate cron). Safe to run
 * on an unattended schedule.
 */
export async function runSpxIssuesSync(): Promise<SpxAdminIssuesPayload> {
  const { merged } = await loadMergedSpxDesk();

  const technicals = await buildPlayTechnicals(merged.price, {
    vwap: merged.vwap,
    pdh: merged.pdh,
    pdl: merged.pdl,
    hod: merged.hod,
    lod: merged.lod,
  });

  const play = await readSpxPlaySnapshot(merged, technicals);

  const issues = await buildSpxAdminIssues({
    desk: merged,
    play,
    marketOpen: merged.market_open === true,
  });

  await syncAdminIncidents(issues.issues, { resolveScope: SPX_ISSUES_RESOLVE_SCOPE });

  return issues;
}
