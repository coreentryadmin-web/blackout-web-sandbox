// Admin HELIX flow-ingestion pipeline health snapshot — the data source behind
// AdminBieDashboard's "HELIX health" panel (task #134). Same shape/contract as
// admin-gex-health.ts (task #138, BlackOut Thermal) and admin-zerodte-health.ts
// (task #150, 0DTE Command): a small, dedicated, READ-ONLY glance at one
// real-time pipeline, separate from the heavier /api/admin/bie-report and any
// full per-product debugging dashboard (there isn't a HELIX equivalent of
// admin-spx-dashboard.ts yet).
//
// FOUR SIGNALS, each independently best-effort — a failure in one leg degrades
// ONLY that leg (see `errors`, same fail-open contract every sibling
// admin-*-health.ts module already uses: every external call individually
// try/caught, this function itself never throws):
//
//   1. Cron liveness for the TWO crons that make up HELIX's flow pipeline —
//      flow-ingest (raw UW flow alerts -> Postgres + live feed) and
//      market-regime-detector (derives flow_regime + writes flow_anomalies +
//      flow_anomaly_near_misses from that same tape) — filtered from the SAME
//      buildCronHealthSnapshot() every other admin cron consumer reads
//      (admin-cron-health.ts's /api/admin/cron-health), so staleness/
//      weekend-multiplier/alternate-writer-skip logic is never re-derived here.
//
//   2. Cluster-wide live-tape heartbeat — peekFlowLivenessHeartbeat()
//      (flow-liveness.ts, task #134) reads the SAME shared Redis heartbeat key
//      isFlowFrameFreshAnywhere() already gates real decisions on (spx-desk.ts,
//      ecosystem-context.ts, spx-signal-log.ts), WITHOUT that function's
//      anti-self-skip instance guard (this is an observability read, not a
//      REST-skip decision) and WITHOUT triggering any reconnect/poll of its
//      own on a miss: a cold heartbeat reports `heartbeat_present: false`,
//      mirroring peekGexHeatmapCache's `cached: false` cold-cache contract —
//      this panel must never add upstream cost just from being viewed.
//
//   3. Today's committed-vs-near-miss anomaly counts — the SAME
//      union/dedup-by-ticker pattern admin-zerodte-health.ts established for
//      zerodte_setup_log/zerodte_scan_rejections, applied to HELIX's own pair:
//      flow_anomalies (COMMITTED — a ticker whose LARGE_PREMIUM_PRINT or
//      DIRECTIONAL_FLOW_SKEW metric cleared the real threshold AND survived
//      the cron's 15-min dedup) and flow_anomaly_near_misses (task #131 — a
//      ticker that was evaluated but fell short of the threshold, or cleared
//      it and got dedup-suppressed). A ticker that both near-missed AND later
//      fired a real anomaly today counts ONCE, as committed — never
//      double-counted (see fetchHelixHealthSnapshot for the exact reasoning).
//      Both tables are read via their EXISTING readers (db.ts's
//      fetchFlowAnomalies, task #131's fetchFlowAnomalyNearMissesFor) — no new
//      instrumentation/counters added for this panel.
//
//   4. Recent HELIX-scoped errors — a best-effort substring filter over the
//      SAME shared error_events sink (error-sink.ts's fetchRecentErrorEvents)
//      admin-gex-health.ts already reads this way. NOT a guarantee of full
//      coverage of every HELIX-pipeline failure (most flow-ingest/
//      detectFlowAnomalies failures are only a console.warn/console.error per
//      those files' existing convention) — only the subset that reached the
//      durable error_events sink.
import { dbConfigured, fetchFlowAnomalies, type FlowAnomalyRow } from "@/lib/db";
import {
  fetchFlowAnomalyNearMissesFor,
  type FlowAnomalyNearMissRow,
} from "@/lib/platform/flow-anomaly-near-misses";
import { buildCronHealthSnapshot, type CronJobHealth } from "@/lib/admin-cron-health";
import { peekFlowLivenessHeartbeat, type FlowLivenessPeek } from "@/lib/flow-liveness";
import { fetchRecentErrorEvents } from "@/lib/error-sink";
import { todayEt, formatEtDate } from "@/lib/nighthawk/session";

/** The two cron-registry.ts jobs that make up HELIX's flow pipeline (see cron-registry.ts). */
const HELIX_CRON_KEYS = new Set(["flow-ingest", "market-regime-detector"]);
/** Best-effort substring match for "is this error_events row about HELIX's flow pipeline". */
const HELIX_ERROR_SCOPE_PATTERN = /helix|flow[-_ ]?anomal|flow[-_]ingest|flow_alert/i;
/** How many flow_anomalies / flow_anomaly_near_misses rows to pull for today's
 *  committed/near-miss union — generous vs. HELIX's real daily volume (a
 *  handful to low tens of distinct anomaly tickers/day; near-misses run
 *  higher but are still bounded by the 5-min RTH cadence and the near-miss
 *  module's own per-(ticker,type,state) throttle). */
const ANOMALY_FETCH_LIMIT = 500;
/** How many recent committed anomalies / near-misses to surface in the panel's own tables. */
const ANOMALY_TABLE_LIMIT = 15;
/** How many recent error_events rows to scan for a HELIX-scoped match (see leg 4 above). */
const RECENT_ERROR_SCAN_LIMIT = 200;
/** How many matched HELIX-scoped errors to surface in the panel. */
const RECENT_ERROR_TABLE_LIMIT = 10;
/** Cluster-heartbeat freshness window — same default every other
 *  isFlowFrameFreshAnywhere() caller uses (spx-desk.ts, ecosystem-context.ts). */
const HEARTBEAT_MAX_AGE_MS = 120_000;

export type HelixHealthCronJob = Pick<
  CronJobHealth,
  "key" | "name" | "status" | "status_label" | "last_run_at" | "age_min" | "runs_24h"
>;

export type HelixHealthRecentError = {
  scope: string | null;
  name: string;
  message: string;
  created_at: string;
};

export type HelixHealthSnapshot = {
  generated_at: string;
  /** ET calendar date the committed/near-miss counts below are scoped to (today). */
  session_date: string;
  db_configured: boolean;
  cron: HelixHealthCronJob[];
  tape: FlowLivenessPeek;
  /** Distinct tickers evaluated today: committed_count + near_miss_only_count
   *  (union, a ticker that both near-missed AND later fired a real anomaly
   *  today counts once, as committed — see fetchHelixHealthSnapshot). */
  candidates_scanned: number;
  /** Distinct tickers with a real (committed) HELIX anomaly today (flow_anomalies). */
  committed_count: number;
  /** Distinct tickers that near-missed today AND never fired a real anomaly
   *  today (flow_anomaly_near_misses, minus anything also in committed_count). */
  near_miss_only_count: number;
  /** near_miss_only_count / candidates_scanned; null when candidates_scanned is
   *  0 (nothing evaluated yet today — an honest "no data", never a fabricated 0%). */
  near_miss_rate: number | null;
  /** Today's committed anomalies, most-recent-first, capped to ANOMALY_TABLE_LIMIT. */
  recent_committed: FlowAnomalyRow[];
  /** Today's near-misses, most-recent-first, capped to ANOMALY_TABLE_LIMIT. */
  recent_near_misses: FlowAnomalyNearMissRow[];
  recent_errors: HelixHealthRecentError[];
  // Partial-failure notes — populated when one leg degrades but the overall
  // snapshot still returns 200 with whatever else succeeded. Never thrown.
  errors: string[];
};

export async function fetchHelixHealthSnapshot(): Promise<HelixHealthSnapshot> {
  const errors: string[] = [];
  // Same "today" convention as admin-zerodte-health.ts's session_date (todayEt()),
  // paired with formatEtDate (admin-cron-health.ts's own "ET date of an arbitrary
  // timestamp" helper) to convert each row's own detected_at/observed_at into a
  // comparable ET calendar date — flow_anomalies/flow_anomaly_near_misses have no
  // session_date column of their own (unlike zerodte_setup_log/
  // zerodte_scan_rejections), so this is the closest equivalent.
  const today = todayEt();

  // Leg 1 — cron liveness, filtered from the SAME snapshot the generic Crons
  // admin tab reads (admin-cron-health.ts) — never re-derives staleness/
  // weekend-multiplier/alternate-writer-skip logic.
  let cronJobs: HelixHealthCronJob[] = [];
  try {
    const cronSnapshot = await buildCronHealthSnapshot();
    cronJobs = cronSnapshot.jobs
      .filter((j) => HELIX_CRON_KEYS.has(j.key))
      .map((j) => ({
        key: j.key,
        name: j.name,
        status: j.status,
        status_label: j.status_label,
        last_run_at: j.last_run_at,
        age_min: j.age_min,
        runs_24h: j.runs_24h,
      }));
  } catch (e) {
    errors.push(`cron health: ${e instanceof Error ? e.message : "failed"}`);
  }

  // Leg 2 — cluster-wide live-tape heartbeat peek. peekFlowLivenessHeartbeat
  // never throws by construction, but this guard mirrors every other leg's
  // "trust nothing, even the read-only helper" discipline.
  let tape: FlowLivenessPeek = {
    heartbeat_present: false,
    last_frame_at: null,
    age_sec: null,
    fresh: false,
  };
  try {
    tape = await peekFlowLivenessHeartbeat(HEARTBEAT_MAX_AGE_MS);
  } catch (e) {
    errors.push(`tape heartbeat: ${e instanceof Error ? e.message : "failed"}`);
  }

  // Leg 3 — today's committed-vs-near-miss anomaly counts (see module doc).
  let committed: FlowAnomalyRow[] = [];
  try {
    committed = await fetchFlowAnomalies({ limit: ANOMALY_FETCH_LIMIT });
  } catch (e) {
    errors.push(`committed anomalies: ${e instanceof Error ? e.message : "failed"}`);
  }

  let nearMisses: FlowAnomalyNearMissRow[] = [];
  try {
    nearMisses = await fetchFlowAnomalyNearMissesFor({ limit: ANOMALY_FETCH_LIMIT });
  } catch (e) {
    errors.push(`near misses: ${e instanceof Error ? e.message : "failed"}`);
  }

  const todaysCommitted = committed.filter((r) => formatEtDate(new Date(r.detected_at)) === today);
  const todaysNearMisses = nearMisses.filter((r) => formatEtDate(new Date(r.observed_at)) === today);

  const committedTickers = new Set(todaysCommitted.map((r) => (r.ticker ?? "SPX").toUpperCase()));
  // A ticker that near-missed earlier today but later fired a real anomaly is a
  // SUCCESS by end of day, not a near-miss — counted once, as committed.
  // Mirrors admin-zerodte-health.ts's committed/rejected union exactly.
  const nearMissOnlyTickers = new Set(
    todaysNearMisses
      .map((r) => (r.ticker ?? "SPX").toUpperCase())
      .filter((t) => !committedTickers.has(t))
  );

  const candidatesScanned = committedTickers.size + nearMissOnlyTickers.size;
  const nearMissRate = candidatesScanned > 0 ? nearMissOnlyTickers.size / candidatesScanned : null;

  // Leg 4 — recent HELIX-scoped errors (best-effort substring filter, see module doc).
  let recentErrors: HelixHealthRecentError[] = [];
  try {
    const rows = await fetchRecentErrorEvents(RECENT_ERROR_SCAN_LIMIT);
    recentErrors = rows
      .filter((r) => HELIX_ERROR_SCOPE_PATTERN.test(`${r.scope ?? ""} ${r.name} ${r.message}`))
      .slice(0, RECENT_ERROR_TABLE_LIMIT)
      .map((r) => ({ scope: r.scope, name: r.name, message: r.message, created_at: r.created_at }));
  } catch (e) {
    errors.push(`recent errors: ${e instanceof Error ? e.message : "failed"}`);
  }

  return {
    generated_at: new Date().toISOString(),
    session_date: today,
    db_configured: dbConfigured(),
    cron: cronJobs,
    tape,
    candidates_scanned: candidatesScanned,
    committed_count: committedTickers.size,
    near_miss_only_count: nearMissOnlyTickers.size,
    near_miss_rate: nearMissRate,
    recent_committed: todaysCommitted.slice(0, ANOMALY_TABLE_LIMIT),
    recent_near_misses: todaysNearMisses.slice(0, ANOMALY_TABLE_LIMIT),
    recent_errors: recentErrors,
    errors,
  };
}
