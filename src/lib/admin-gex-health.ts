// Admin BlackOut Thermal (GEX/heatmap pipeline) health snapshot — the data source behind
// AdminBieDashboard's "Thermal health" panel (task #138). Same pattern as SPX Slayer's
// admin-spx-health.ts / /api/admin/spx/health (task #111): a small, dedicated, READ-ONLY
// glance for one real-time product's pipeline, separate from the heavier per-product
// debugging surfaces (there isn't a Thermal equivalent of admin-spx-dashboard.ts yet) and
// from /api/admin/bie-report (BIE-specific: interactions/calibration/discovery).
//
// FOUR SIGNALS, each independently best-effort — a failure in one leg degrades ONLY that
// leg (see `errors`, same fail-open contract admin-spx-health.ts's fetchSpxHealthSnapshot
// uses: every external call individually try/caught, this function itself never throws):
//
//   1. Per-ticker cache freshness for the ~11 Thermal presets (heatmapPresetTickers) —
//      peekGexHeatmapCache (polygon-options-gex.ts, task #138) reads the SAME shared
//      `gex-heatmap:{ticker}` cache entry the live /api/market/gex-heatmap route serves,
//      WITHOUT triggering a fresh build on a miss — a build costs a live Polygon chain
//      fetch, and this panel must never add upstream cost just from being viewed.
//
//   2. Durable regime-transition history — fetchGexRegimeEvents (task #136,
//      gex-regime-events.ts) reads the gex_regime_events Postgres log: recent
//      flip/wall/regime crossings across EVERY ticker computeGexEvents() has diffed, not
//      just the 3-ticker REGIME_WATCHLIST (SPY/SPX/QQQ) /api/cron/gex-alerts pushes for.
//
//   3. Cron liveness for the THREE Thermal-owned jobs (heatmap-warm, gex-eod-snapshot,
//      gex-alerts) — filtered from the SAME buildCronHealthSnapshot() every job in
//      cron-registry.ts already feeds (admin-cron-health.ts's /api/admin/cron-health),
//      so staleness / weekend-multiplier / off-window suppression logic is never
//      re-derived here — ONE DERIVATION, read twice (the generic cron dashboard's full
//      job list, and this filtered Thermal-only slice).
//
//   4. Recent GEX-scoped errors — a best-effort substring filter over the SAME shared
//      error_events sink (error-sink.ts's fetchRecentErrorEvents) every other admin
//      surface reads. There is no dedicated GEX error-capture path, so this is honestly a
//      filtered view of the generic sink (ticker/scope/message matching /gex|heatmap|
//      thermal/i) — NOT a guarantee of full coverage of every GEX-pipeline failure (most
//      chain-fetch failures in polygon-options-gex.ts are only a console.warn, per that
//      file's existing convention — this leg only sees the subset that reached the
//      durable error_events sink via captureError/recordAdminRouteError elsewhere).
import { heatmapPresetTickers } from "@/lib/heatmap-allowlist";
import { peekGexHeatmapCache, type GexHeatmapCachePeek } from "@/lib/providers/polygon-options-gex";
import { fetchGexRegimeEvents, type GexRegimeEventRow } from "@/lib/providers/gex-regime-events";
import { buildCronHealthSnapshot, type CronJobHealth } from "@/lib/admin-cron-health";
import { fetchRecentErrorEvents } from "@/lib/error-sink";
import { dbConfigured } from "@/lib/db";

/** The three cron-registry.ts jobs that make up the Thermal/GEX pipeline (see cron-registry.ts). */
const THERMAL_CRON_KEYS = new Set(["heatmap-warm", "gex-eod-snapshot", "gex-alerts"]);
/** Best-effort substring match for "is this error_events row about the GEX pipeline". */
const GEX_ERROR_SCOPE_PATTERN = /gex|heatmap|thermal/i;
/** Window the regime-event summary counts over — long enough to span a full trading day. */
const REGIME_EVENT_SUMMARY_WINDOW_MS = 24 * 60 * 60_000;
/** How many regime-event rows to pull for the summary — bounded, mirrors fetchRecentSpxSignals'
 *  own small-N reads; large enough to cover a busy day across all ~11 presets. */
const REGIME_EVENT_FETCH_LIMIT = 200;
/** How many raw regime-event rows to surface in the panel's own table (most-recent-first). */
const REGIME_EVENT_TABLE_LIMIT = 15;
/** How many recent error_events rows to scan for a GEX-scoped match (see leg 4 above). */
const RECENT_ERROR_SCAN_LIMIT = 200;
/** How many matched GEX-scoped errors to surface in the panel. */
const RECENT_ERROR_TABLE_LIMIT = 10;

export type GexTickerHealth = GexHeatmapCachePeek;

export type GexRegimeEventSummary = {
  window_hours: number;
  total: number;
  by_ticker: Array<{ ticker: string; count: number }>;
  by_type: Array<{ type: string; count: number }>;
};

export type GexHealthCronJob = Pick<
  CronJobHealth,
  "key" | "name" | "status" | "status_label" | "last_run_at" | "age_min" | "runs_24h"
>;

export type GexHealthRecentError = {
  scope: string | null;
  name: string;
  message: string;
  created_at: string;
};

export type GexHealthSnapshot = {
  generated_at: string;
  db_configured: boolean;
  tickers: GexTickerHealth[];
  regime_events: {
    summary: GexRegimeEventSummary;
    recent: GexRegimeEventRow[];
  };
  cron: GexHealthCronJob[];
  recent_errors: GexHealthRecentError[];
  // Partial-failure notes — populated when one leg degrades but the overall snapshot still
  // returns 200 with whatever else succeeded. Never thrown (see module doc).
  errors: string[];
};

/** Summarize regime-event rows (already most-recent-first) into per-ticker/per-type counts
 *  over the trailing `windowMs`. Pure — no I/O, easy to unit test independent of the fetch. */
export function summarizeRegimeEvents(
  rows: GexRegimeEventRow[],
  windowMs: number
): GexRegimeEventSummary {
  const cutoff = Date.now() - windowMs;
  const inWindow = rows.filter((r) => {
    const t = new Date(r.observed_at).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });

  const byTicker = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const r of inWindow) {
    byTicker.set(r.ticker, (byTicker.get(r.ticker) ?? 0) + 1);
    byType.set(r.event_type, (byType.get(r.event_type) ?? 0) + 1);
  }

  return {
    window_hours: Math.round(windowMs / 3_600_000),
    total: inWindow.length,
    by_ticker: Array.from(byTicker.entries())
      .map(([ticker, count]) => ({ ticker, count }))
      .sort((a, b) => b.count - a.count),
    by_type: Array.from(byType.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function fetchGexHealthSnapshot(): Promise<GexHealthSnapshot> {
  const errors: string[] = [];

  // Leg 1 — per-ticker cache freshness. Independent per ticker so one ticker's peek
  // throwing (should never happen — peekGexHeatmapCache never throws by construction, but
  // this guard mirrors admin-spx-health.ts's "trust nothing, even the read-only helper")
  // never blanks the other ~10 tickers' rows.
  const tickers = await Promise.all(
    heatmapPresetTickers().map(async (ticker) => {
      try {
        return await peekGexHeatmapCache(ticker);
      } catch (e) {
        errors.push(`ticker ${ticker}: ${e instanceof Error ? e.message : "failed"}`);
        const fallback: GexTickerHealth = {
          ticker,
          cached: false,
          last_compute_at: null,
          age_sec: null,
          ttl_sec: 0,
          stale: true,
          spot: null,
          events_count: null,
        };
        return fallback;
      }
    })
  );

  // Leg 2 — durable regime-transition history (task #136). One shared fetch feeds both the
  // panel's summary counts and its raw recent-rows table — no second query.
  let regimeRows: GexRegimeEventRow[] = [];
  try {
    regimeRows = await fetchGexRegimeEvents({ limit: REGIME_EVENT_FETCH_LIMIT });
  } catch (e) {
    errors.push(`regime events: ${e instanceof Error ? e.message : "failed"}`);
  }

  // Leg 3 — cron liveness, filtered from the SAME snapshot the generic Crons admin tab
  // reads (admin-cron-health.ts) — never re-derives staleness/weekend-multiplier logic.
  let cronJobs: GexHealthCronJob[] = [];
  try {
    const cronSnapshot = await buildCronHealthSnapshot();
    cronJobs = cronSnapshot.jobs
      .filter((j) => THERMAL_CRON_KEYS.has(j.key))
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

  // Leg 4 — recent GEX-scoped errors (best-effort substring filter, see module doc).
  let recentErrors: GexHealthRecentError[] = [];
  try {
    const rows = await fetchRecentErrorEvents(RECENT_ERROR_SCAN_LIMIT);
    recentErrors = rows
      .filter((r) => GEX_ERROR_SCOPE_PATTERN.test(`${r.scope ?? ""} ${r.name} ${r.message}`))
      .slice(0, RECENT_ERROR_TABLE_LIMIT)
      .map((r) => ({ scope: r.scope, name: r.name, message: r.message, created_at: r.created_at }));
  } catch (e) {
    errors.push(`recent errors: ${e instanceof Error ? e.message : "failed"}`);
  }

  return {
    generated_at: new Date().toISOString(),
    db_configured: dbConfigured(),
    tickers,
    regime_events: {
      summary: summarizeRegimeEvents(regimeRows, REGIME_EVENT_SUMMARY_WINDOW_MS),
      recent: regimeRows.slice(0, REGIME_EVENT_TABLE_LIMIT),
    },
    cron: cronJobs,
    recent_errors: recentErrors,
    errors,
  };
}
