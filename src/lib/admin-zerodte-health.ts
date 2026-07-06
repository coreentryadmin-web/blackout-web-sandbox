// Admin 0DTE Command health snapshot — the data source behind AdminBieDashboard's
// "0DTE Command health" panel (see AdminBieDashboard.tsx and
// src/app/api/admin/zerodte/health/route.ts). Direct analogue of task #111's
// admin-spx-health.ts, applied to the SEPARATE multi-ticker scanner branded
// "0DTE Command" in-app (`/grid`'s default tab), NOT SPX Slayer's own
// single-instrument engine — see task #127's FINDINGS.md entry for the naming
// disambiguation this codebase already had to fix once.
//
// Surfaces 3 things an admin glancing at BIE wants for this scanner:
//   1. last-scan-time — when the scan pipeline last actually ran.
//   2. candidates-scanned — how many distinct tickers the scanner has evaluated
//      today (committed to the board + rejected by a gate).
//   3. rejection-rate — what share of today's candidates never made the board.
//
// DELIBERATELY sourced from data ALREADY PERSISTED by two existing pipelines —
// no new instrumentation/counters were added for this panel:
//   - `zerodte_setup_log` (persistZeroDteScan, src/lib/zerodte/scan.ts) — the
//     COMMITTED half: every ticker that cleared all 4 gates in
//     deriveZeroDteSetups() (src/lib/zerodte/board.ts) at least once today.
//   - `zerodte_scan_rejections` (persistZeroDteRejections, task #147,
//     src/lib/zerodte/rejections.ts) — the REJECTED half: every ticker that
//     failed a gate, throttled to one row per (ticker, gate_failed, direction)
//     state-transition (NOT one row per scan cycle) — see rejections.ts's
//     module doc for why. That throttle is exactly why "candidates scanned"
//     below is a TODAY-cumulative distinct-ticker count, not a last-cycle
//     count: the persisted rejections log cannot reconstruct how many
//     candidates were considered in any ONE scan tick (an unchanged rejection
//     is never re-written), only how many distinct tickers have transitioned
//     through a rejected state at some point today.
//
// LAST-SCAN-TIME: there is no dedicated "zerodte" entry in cron-registry.ts —
// warmZeroDteBoard() (scan.ts), the only path that calls persistZeroDteScan/
// persistZeroDteRejections, is invoked exclusively from the "grid-warm" cron
// (src/app/api/cron/grid-warm/route.ts's GET, alongside 8 unrelated
// market-wide Grid warmers in the same Promise.allSettled tick). Per this
// repo's standing instruction to mirror an existing logCronRun-based
// mechanism rather than invent a new one, this reuses buildCronHealthSnapshot()
// (admin-cron-health.ts) — the SAME function AdminCronDashboard.tsx,
// /api/admin/bie-report, and the cron-staleness-watchdog cron already read —
// and picks out its "grid-warm" job entry verbatim (status/status_label/
// age_min/stale_after_min all come from that function's own market-hours-aware
// staleness logic, not reimplemented here). The known imprecision this
// inherits: a "healthy" grid-warm tick only proves THE CRON ran, not that the
// 0DTE Command scan specifically found/logged anything that tick (grid-warm's
// own logCronRun payload has no per-warmer breakdown) — documented rather than
// worked around by adding new instrumentation.
//
// Every external call is individually try/caught (same discipline
// admin-spx-health.ts established) so one degraded leg still returns a usable
// snapshot for the rest of the panel.
import { dbConfigured, fetchZeroDteSetupLog, type ZeroDteSetupLogRow } from "@/lib/db";
import { fetchZeroDteRejections, type ZeroDteRejectionRow } from "@/lib/zerodte/rejections";
import { buildCronHealthSnapshot, type CronJobHealthStatus } from "@/lib/admin-cron-health";
import { todayEt } from "@/lib/nighthawk/session";

/** Generous vs. the throttled write volume rejections.ts documents (single digits
 *  to low tens of distinct tickers per day) — a page this size should cover a full
 *  session in practice; `rejections_sample_capped` below reports honestly when it
 *  might not have. */
const REJECTIONS_SAMPLE_LIMIT = 500;

export type ZeroDteHealthScanSummary = {
  last_scan_at: string | null;
  status: CronJobHealthStatus;
  status_label: string;
  age_min: number | null;
  stale_after_min: number;
};

export type ZeroDteHealthSnapshot = {
  generated_at: string;
  session_date: string;
  db_configured: boolean;
  /** grid-warm cron status — the cron that runs warmZeroDteBoard() (see module doc). */
  scan: ZeroDteHealthScanSummary;
  /** Distinct tickers evaluated today: committed_count + rejected_count (union, a
   *  ticker that both failed a gate AND later made the board today counts once,
   *  as committed — see fetchZeroDteHealthSnapshot for the exact reasoning). */
  candidates_scanned: number;
  /** Distinct tickers that cleared every gate at least once today (zerodte_setup_log). */
  committed_count: number;
  /** Distinct tickers that failed a gate today AND never made the board today
   *  (zerodte_scan_rejections, minus anything also in committed_count). */
  rejected_count: number;
  /** rejected_count / candidates_scanned; null when candidates_scanned is 0 (nothing
   *  scanned yet today — an honest "no data", never a fabricated 0%). */
  rejection_rate: number | null;
  /** True when the rejections read may have been truncated by REJECTIONS_SAMPLE_LIMIT
   *  before reaching an earlier-today row — candidates_scanned/rejection_rate could
   *  then be a floor, not the exact count. False the overwhelming majority of the
   *  time given the throttled write volume. */
  rejections_sample_capped: boolean;
  // Partial-failure notes — populated when one leg degrades but the overall
  // snapshot still returns 200 with whatever else succeeded. Never thrown.
  errors: string[];
};

export async function fetchZeroDteHealthSnapshot(): Promise<ZeroDteHealthSnapshot> {
  const errors: string[] = [];
  const sessionDate = todayEt();

  let scan: ZeroDteHealthScanSummary = {
    last_scan_at: null,
    status: "unknown",
    status_label: "No runs logged",
    age_min: null,
    stale_after_min: 0,
  };
  try {
    const cronHealth = await buildCronHealthSnapshot();
    const gridWarm = cronHealth.jobs.find((j) => j.key === "grid-warm");
    if (gridWarm) {
      scan = {
        last_scan_at: gridWarm.last_run_at,
        status: gridWarm.status,
        status_label: gridWarm.status_label,
        age_min: gridWarm.age_min,
        stale_after_min: gridWarm.stale_after_min,
      };
    }
  } catch (e) {
    errors.push(`cron health: ${e instanceof Error ? e.message : "failed"}`);
  }

  let committed: ZeroDteSetupLogRow[] = [];
  try {
    committed = await fetchZeroDteSetupLog(sessionDate);
  } catch (e) {
    errors.push(`setup log: ${e instanceof Error ? e.message : "failed"}`);
  }

  let rejections: ZeroDteRejectionRow[] = [];
  try {
    rejections = await fetchZeroDteRejections({ limit: REJECTIONS_SAMPLE_LIMIT });
  } catch (e) {
    errors.push(`rejections: ${e instanceof Error ? e.message : "failed"}`);
  }

  const todaysRejections = rejections.filter((r) => r.session_date === sessionDate);
  const committedTickers = new Set(committed.map((r) => r.ticker.toUpperCase()));
  // A ticker that failed a gate earlier today but later cleared every gate and made
  // the board is a SUCCESS by end of day, not a rejection — counted once, as
  // committed. Prevents double-counting the same ticker across both tables.
  const rejectedOnlyTickers = new Set(
    todaysRejections.map((r) => r.ticker.toUpperCase()).filter((t) => !committedTickers.has(t))
  );

  const candidatesScanned = committedTickers.size + rejectedOnlyTickers.size;
  const rejectionRate = candidatesScanned > 0 ? rejectedOnlyTickers.size / candidatesScanned : null;

  // fetchZeroDteRejections orders by observed_at DESC. If the full page came back
  // AND its oldest row is still from today, there may be earlier-today rows beyond
  // the page we never saw (truncation); if the oldest row is already from a prior
  // day, every one of today's rows was necessarily included.
  const rejectionsSampleCapped =
    rejections.length === REJECTIONS_SAMPLE_LIMIT &&
    rejections[rejections.length - 1]?.session_date === sessionDate;

  return {
    generated_at: new Date().toISOString(),
    session_date: sessionDate,
    db_configured: dbConfigured(),
    scan,
    candidates_scanned: candidatesScanned,
    committed_count: committedTickers.size,
    rejected_count: rejectedOnlyTickers.size,
    rejection_rate: rejectionRate,
    rejections_sample_capped: rejectionsSampleCapped,
    errors,
  };
}
